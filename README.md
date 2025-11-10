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
import steam from "depot-downloader";

const Downloader = new steam.Downloader();

Downloader.on("log", console.log);
Downloader.on("finish", console.log);
Downloader.on("error", console.error);

await Downloader.downloadDepot({
    manifestFile: "C:\\Path\\To\\File.manifest",
    decryptionKey: "HEX_DECRYPTION_KEY"
});
```

---

## Options

| Name            | Description                  |
| --------------- | ---------------------------- |
| `manifestFile`  | Path to the `.manifest` file |
| `decryptionKey` | Depot key in HEX format      |

Optional constructor settings:

```js
new steam.Downloader({
    outputDirectory: "./output",
    maxServers: 2
});
```

---

## Events

| Event    | When              |
| -------- | ----------------- |
| `log`    | Download progress |
| `finish` | Download complete |
| `error`  | Error occurred    |

---

## Credits

This project includes code from:

- DoctorMcKay/node-steam-user (MIT License)  
  https://github.com/DoctorMcKay/node-steam-user