import steam from "depot-downloader";

const Downloader = new steam.Downloader();

Downloader.on("log", console.log);
Downloader.on("finish", console.log);
Downloader.on("error", console.error);

await Downloader.downloadDepot({
    manifestFile: "C:\\Path\\To\\File.manifest",
    decryptionKey: "HEX_DECRYPTION_KEY"
});