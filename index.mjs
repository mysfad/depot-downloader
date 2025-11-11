import { EventEmitter } from 'events'
import path from 'path'
import fs from 'fs/promises'
import pLimit from 'p-limit'
import Crypto from 'crypto'
import helper from './helper.mjs'

class Downloader extends EventEmitter {
    constructor({outputDirectory, maxServers} = {}) {
        super()
        this.outputDirectory = outputDirectory || './output'
        this.maxServers = maxServers || 2
    }

    #limitedDownload
    #manifestFile
    #keyBuffer
    #manifest
    #depotID
    #filteredFiles = []
    #singleChunkFiles = []
    #multiChunkFiles = []
    #servers
    #serverIndex = 0
    #downloadedFiles = 0

    async downloadDepot({manifestFile, decryptionKey}) {
        try {
            this.#manifestFile = manifestFile
            this.#keyBuffer = Buffer.from(decryptionKey, 'hex')
            this.emit('progress', 'Parsing manifest...')
            await this.#parseManifest()
            this.emit('progress', 'Sorting files...')
            await this.#sortFiles()
            this.emit('progress', 'Filtering files...')
            await this.#filterFiles()
            if (this.#filteredFiles.length === 0) return this.emit('finish', 'No files to download...')
            this.emit('progress', 'Making directory...')
            await this.#makeDirectory()
            this.emit('progress', 'Getting servers...')
            await this.#getServers()
            this.#limitedDownload = pLimit(this.maxServers)
            this.emit('progress', 'Downloading depot...')
            const start = performance.now()
            await this.#downloadAllFiles()
            const end = performance.now()
            const totalTime = ((end - start) / 1000 / 60).toFixed(2) + 'm'
            this.emit('finish', `Finished downloading depot... ${this.#depotID} in ${totalTime}`)
        } catch (error) {
            this.emit('error', error)
        }
    }

    async #parseManifest() {
        const manifestBuffer = await fs.readFile(this.#manifestFile)
        this.#manifest = helper.parse(manifestBuffer)
        if (this.#manifest.filenames_encrypted) helper.decryptFilenames(this.#manifest, this.#keyBuffer)
        this.#depotID = String(this.#manifest.depot_id)
    }

    async #sortFiles() {
        this.#manifest.files = this.#manifest.files
            .filter((i) => !(i.flags & helper.EDepotFileFlag.Directory))
            .sort((a, b) => Number(a.size) - Number(b.size))
            .map((i) => {
                const chunks = i.chunks
                    .sort((a, b) => Number(a.offset) - Number(b.offset))
                    .map((c) => c.sha)
                const newItem = {
                    filepath: path.join(this.outputDirectory, this.#depotID, i.filename).replace(/\\/g, '/'),
                    size: i.size,
                    chunks,
                }
                return newItem
            })
    }

    async #filterFiles() {
        const files = this.#manifest.files
        for await (const item of files) {
            try {
                const stat = await fs.stat(item.filepath)
                if (stat.size !== Number(item.size)) this.#filteredFiles.push(item)
            } catch (error) {
                this.#filteredFiles.push(item)
            }
        }
        this.#singleChunkFiles = this.#filteredFiles.filter((i) => i.chunks.length === 1)
        this.#multiChunkFiles = this.#filteredFiles.filter((i) => i.chunks.length > 1)
    }

    async #makeDirectory() {
        for await (const file of this.#filteredFiles) {
            const fileDir = path.dirname(file.filepath)
            await fs.mkdir(fileDir, {recursive: true})
        }
    }

    async #getServers() {
        const maxServers = `max_servers=${this.maxServers}`
        const url = 'https://api.steampowered.com/IContentServerDirectoryService/GetServersForSteamPipe/v1'
        const res = await fetch(url + '?' + maxServers)
        if (!res.ok) throw new Error('Failed to get servers')
        const data = await res.json()
        this.#servers = data.response.servers
    }

    async #downloadAllFiles() {
        await this.#downloadSingleChunkFiles()
        await this.#downloadMultiChunkFiles()
    }

    async #downloadSingleChunkFiles() {
        const tasks = this.#singleChunkFiles.map((file) => {
            return this.#limitedDownload(async () => {
                this.#progress(file, 0)
                const chunk = file.chunks[0]
                const buffer = await this.#processChunk(chunk)
                await fs.writeFile(file.filepath, buffer)
            })
        })
        await Promise.all(tasks)
    }

    async #downloadMultiChunkFiles() {
        for await (const file of this.#multiChunkFiles) {
            const tasks = file.chunks.map((chunk, index) => {
                return this.#limitedDownload(async () => {
                    this.#progress(file, index)
                    const buffer = await this.#processChunk(chunk)
                    return buffer
                })
            })
            const buffers = await Promise.all(tasks)
            const buffer = Buffer.concat(buffers)
            await fs.writeFile(file.filepath, buffer)
        }
    }

    async #processChunk(chunk) {
        const buffer = await this.#downloadChunk(chunk)
        const bufferDecrypted = await helper.symmetricDecrypt(buffer, this.#keyBuffer)
        const bufferDecompressed = await helper.unzip(bufferDecrypted)
        const hash = Crypto.createHash('sha1').update(bufferDecompressed).digest('hex')
        if (hash !== chunk) throw new Error('Hash mismatch')
        return bufferDecompressed
    }

    async #downloadChunk(chunk) {
        const { https_support, host } = this.#chooseServer()
        const protocol = https_support === 'mandatory' ? 'https' : 'http'
        const url = `${protocol}://${host}/depot/${this.#depotID}/chunk/${chunk}`
        const res = await fetch(url)
        const data = await res.arrayBuffer()
        return Buffer.from(data)
    }

    #chooseServer() {
        const server = this.#servers[this.#serverIndex]
        this.#serverIndex = (this.#serverIndex + 1) % this.#servers.length
        return server
    }

    #progress(file, index) {
        if (index === 0) this.#downloadedFiles++
        const progressDepot = ((this.#downloadedFiles / this.#filteredFiles.length) * 100).toFixed(2) + '%'
        const progressFile = (((index + 1) / file.chunks.length) * 100).toFixed(2) + '%'
        this.emit('progress', `${progressDepot} | ${progressFile} - ${file.filepath}`)
    }
}

export { Downloader }