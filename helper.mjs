const helper = {}

import StdLib from '@doctormckay/stdlib'
import AdmZip from 'adm-zip'
import ByteBuffer from 'bytebuffer'
import LZMA from 'lzma'
import protobuf from 'protobufjs/light.js'
import { ZSTDDecoder } from 'zstddec'
import Crypto from 'crypto'
import contentManifestJson from './content_manifest.json' with { type: 'json' }

const contentManifest = protobuf.Root.fromJSON(contentManifestJson)
const ContentManifestPayload = contentManifest.lookupType('ContentManifestPayload')
const ContentManifestMetadata = contentManifest.lookupType('ContentManifestMetadata')

const HEADER_ZSTD = 'VSZa'
const HEADER_VZIP = 'VZa'
const HEADER_ZIP = 'PK\u0003\u0004'

const FOOTER_ZSTD = 'zsv'
const FOOTER_VZIP = 'zv'

const PROTOBUF_PAYLOAD_MAGIC = 0x71F617D0
const PROTOBUF_METADATA_MAGIC = 0x1F4812BE
const PROTOBUF_SIGNATURE_MAGIC = 0x1B81B817
const PROTOBUF_ENDOFMANIFEST_MAGIC = 0x32C415AB
const STEAM3_MANIFEST_MAGIC = 0x16349781

helper.EDepotFileFlag = {
	'UserConfig': 1,
	'VersionedUserConfig': 2,
	'Encrypted': 4,
	'ReadOnly': 8,
	'Hidden': 16,
	'Executable': 32,
	'Directory': 64,
	'CustomExecutable': 128,
	'InstallScript': 256,
	'Symlink': 512,
}

function _decodeProto(proto, encoded) {
    if (ByteBuffer.isByteBuffer(encoded)) {
        encoded = encoded.toBuffer()
    }

    let decoded = proto.decode(encoded)
    let objNoDefaults = proto.toObject(decoded, {longs: String})
    let objWithDefaults = proto.toObject(decoded, {defaults: true, longs: String})
    return replaceDefaults(objNoDefaults, objWithDefaults)

    function replaceDefaults(noDefaults, withDefaults) {
        if (Array.isArray(withDefaults)) {
            return withDefaults.map((val, idx) => replaceDefaults(noDefaults[idx], val))
        }

        for (let i in withDefaults) {
            if (!Object.hasOwnProperty.call(withDefaults, i)) {
                continue
            }

            if (withDefaults[i] && typeof withDefaults[i] === 'object' && !Buffer.isBuffer(withDefaults[i])) {
                withDefaults[i] = replaceDefaults(noDefaults[i], withDefaults[i])
            } else if (typeof noDefaults[i] === 'undefined' && isReplaceableDefaultValue(withDefaults[i])) {
                withDefaults[i] = null
            }
        }

        return withDefaults
    }

    function isReplaceableDefaultValue(val) {
        if (Buffer.isBuffer(val) && val.length == 0) {
            return true
        }

        if (Array.isArray(val)) {
            return false
        }

        if (val === '0') {
            return true
        }

        return !val
    }
}

helper.parse = function(buffer) {
	if (!ByteBuffer.isByteBuffer(buffer)) {
		buffer = ByteBuffer.wrap(buffer, ByteBuffer.LITTLE_ENDIAN)
	}

	let manifest = {}
	let magic
	let meta
	let length

	while (buffer.remaining() > 0) {
		magic = buffer.readUint32()
		switch (magic) {
			case PROTOBUF_PAYLOAD_MAGIC:
				length = buffer.readUint32()
				manifest.files = _decodeProto(ContentManifestPayload, buffer.slice(buffer.offset, buffer.offset + length)).mappings
				buffer.skip(length)
				break

			case PROTOBUF_METADATA_MAGIC:
				length = buffer.readUint32()
				meta = _decodeProto(ContentManifestMetadata, buffer.slice(buffer.offset, buffer.offset + length))
				buffer.skip(length)
				break

			case PROTOBUF_SIGNATURE_MAGIC:
				length = buffer.readUint32()
				buffer.skip(length)
				break

			case PROTOBUF_ENDOFMANIFEST_MAGIC:
				break

			case STEAM3_MANIFEST_MAGIC:
				throw new Error('Received unexpected Steam3 manifest not yet implemented')

			default:
				throw new Error(`Unknown magic value ${magic.toString(16)} at offset ${buffer.offset - 4}`)
		}
	}

	(manifest.files || []).forEach(function process(file) {
		for (let i in file) {
			if (!Object.hasOwnProperty.call(file, i)) {
				continue
			}

			if (file[i] instanceof ByteBuffer) {
				file[i] = file[i].toString('hex')
			} else if (file[i] instanceof ByteBuffer.Long) {
				file[i] = file[i].toString()
			} else if (Buffer.isBuffer(file[i])) {
				file[i] = file[i].toString('hex')
			} else if (file[i] && !Buffer.isBuffer(file[i]) && typeof file[i] === 'object') {
				process(file[i])
			}
		}
	})

	if (meta) {
		for (let i in meta) {
			if (Object.hasOwnProperty.call(meta, i)) {
				manifest[i] = meta[i] instanceof ByteBuffer.Long ? meta[i].toString() : meta[i]
			}
		}
	}

	return manifest
}

helper.decryptFilenames = function(manifest, key) {
	if (!manifest.filenames_encrypted) {
		return
	}

	(manifest.files || []).forEach(function(file) {
		file.filename = helper.symmetricDecrypt(Buffer.from(file.filename, 'base64'), key)
		file.filename = file.filename.slice(0, file.filename.indexOf(0)).toString('utf8')
	})

	manifest.filenames_encrypted = false
}

helper.unzip = async function(data) {
	let headerString = data.slice(0, 4).toString('utf8')

	if (headerString.startsWith(HEADER_ZSTD)) {
		return decompressZstd(data)
	}

	if (headerString.startsWith(HEADER_VZIP)) {
		return decompressVzip(data)
	}

	if (headerString.startsWith(HEADER_ZIP)) {
		return decompressZip(data)
	}

	throw new Error(`Unknown compression type: ${headerString} (${data.slice(0, 4).toString('hex')})`)
}

function decompressZstd(data) {
	return new Promise((resolve, reject) => {
		let buffer = ByteBuffer.wrap(data, ByteBuffer.LITTLE_ENDIAN)

		if (buffer.readUTF8String(HEADER_ZSTD.length) != HEADER_ZSTD) {
			return reject(new Error('Zstd: Didn\'t see expected header'))
		}

		buffer.skip(4)
		let compressedData = buffer.slice(buffer.offset, buffer.limit - 15)
		buffer.skip(compressedData.remaining())

		let decompressedCrc = buffer.readUint32()
		let decompressedSize = buffer.readUint32()
		buffer.skip(4)
		if (buffer.readUTF8String(FOOTER_ZSTD.length) != FOOTER_ZSTD) {
			return reject(new Error('Zstd: Didn\'t see expected footer'))
		}

		let decoder = new ZSTDDecoder()
		decoder.init()
			.then(() => {
				let result = Buffer.from(decoder.decode(compressedData.toBuffer(), decompressedSize))

				if (decompressedSize != result.length) {
					return reject(new Error('Zstd: Decompressed size was not valid'))
				}

				if (StdLib.Hashing.crc32(result) != decompressedCrc) {
					return reject(new Error('Zstd: CRC check failed on decompressed data'))
				}

				return resolve(result)
			})
	})
}

function decompressVzip(data) {
	return new Promise((resolve, reject) => {
		let buffer = ByteBuffer.wrap(data, ByteBuffer.LITTLE_ENDIAN)

		if (buffer.readUTF8String(HEADER_VZIP.length) != HEADER_VZIP) {
			return reject(new Error('VZip: Didn\'t see expected header'))
		}

		buffer.skip(4)
		let properties = buffer.slice(buffer.offset, buffer.offset + 5).toBuffer()
		buffer.skip(5)

		let compressedData = buffer.slice(buffer.offset, buffer.limit - 10)
		buffer.skip(compressedData.remaining())

		let decompressedCrc = buffer.readUint32()
		let decompressedSize = buffer.readUint32()
		if (buffer.readUTF8String(FOOTER_VZIP.length) != FOOTER_VZIP) {
			return reject(new Error('VZip: Didn\'t see expected footer'))
		}

		let uncompressedSizeBuffer = Buffer.alloc(8)
		uncompressedSizeBuffer.writeUInt32LE(decompressedSize, 0)
		uncompressedSizeBuffer.writeUInt32LE(0, 4)

		LZMA.decompress(Buffer.concat([properties, uncompressedSizeBuffer, compressedData.toBuffer()]), (result, err) => {
			if (err) {
				return reject(err)
			}

			result = Buffer.from(result)

			if (decompressedSize != result.length) {
				return reject(new Error('VZip: Decompressed size was not valid'))
			}

			if (StdLib.Hashing.crc32(result) != decompressedCrc) {
				return reject(new Error('VZip: CRC check failed on decompressed data'))
			}

			return resolve(result)
		})
	})
}

function decompressZip(data) {
	let unzip = new AdmZip(data)
	return unzip.readFile(unzip.getEntries()[0])
}

helper.symmetricDecrypt = function(input, key, checkHmac) {
	const aesIv = Crypto.createDecipheriv('aes-256-ecb', key, '')
	aesIv.setAutoPadding(false)
	aesIv.end(input.slice(0, 16))
	const iv = aesIv.read()

	const aesData = Crypto.createDecipheriv('aes-256-cbc', key, iv)
	aesData.end(input.slice(16))
	const plaintext = aesData.read()

	if (checkHmac) {
		const remotePartialHmac = iv.slice(0, iv.length - 3)
		const random = iv.slice(iv.length - 3, iv.length)
		const hmac = Crypto.createHmac('sha1', key.slice(0, 16))
		hmac.update(random)
		hmac.update(plaintext)
		if (!remotePartialHmac.equals(hmac.digest().slice(0, remotePartialHmac.length))) {
			throw new Error('Received invalid HMAC from remote host.')
		}
	}

	return plaintext
}

export default helper