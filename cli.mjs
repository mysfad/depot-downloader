#!/usr/bin/env node

import { Downloader } from './index.mjs'
import { Command } from 'commander'

const program = new Command()
program
    .name('Depot Downloader')
    .description('Steam Depot Downloader CLI')
    .version('0.0.1')
    .requiredOption('--manifest <path>', 'Manifest File Path')
    .requiredOption('--key <key>', 'Decryption Key')
    .option('--output <dir>', 'Output Directory', './output')
    .option('--max-servers <num>', 'Max Servers', 2)
    .parse()

const { manifest, key, output, maxServers } = program.opts()

const downloader = new Downloader({
    outputDirectory: output,
    maxServers,
})

downloader.on('progress', console.log)
downloader.on('finish', console.log)
downloader.on('error', console.error)

await downloader.downloadDepot({
    manifestFile: manifest,
    decryptionKey: key,
})

process.exit(0)