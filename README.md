# depot-downloader

A simple Steam Depot Downloader for Node.js.

This package allows you to Download Game Files from Steam using `Manifest File` and `Decryption Key`.

---

## Installation

```sh
npm install depot-downloader
````

---

## Usage

```js
import { Downloader } from 'depot-downloader'

const downloader = new Downloader()

downloader.on('progress', console.log)
downloader.on('finish', console.log)
downloader.on('error', console.error)

await downloader.downloadDepot({
    manifestFile: './Path/To/File.manifest',
    decryptionKey: 'DECRYPTION_KEY',
})
```

---

## Options

| Name            | Description                  |
| --------------- | ---------------------------- |
| `manifestFile`  | Path to the `.manifest` file |
| `decryptionKey` | Depot key in HEX format      |

Optional constructor settings:

```js
new Downloader({
    outputDirectory: './output',
    maxServers: 2
});
```

---

## Events

| Event      | When              |
| ---------- | ----------------- |
| `progress` | Download Progress |
| `finish`   | Download Complete |
| `error`    | Error Occurred    |

---

## Credits

This Project includes Code from:

- DoctorMcKay/node-steam-user (MIT License)  
  https://github.com/DoctorMcKay/node-steam-user