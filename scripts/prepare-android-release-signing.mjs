import { readFile, writeFile } from "node:fs/promises";

const gradlePath = "android/app/build.gradle";
const getConfig = (name) =>
  process.env[name] ?? process.env[`ORG_GRADLE_PROJECT_${name}`];

const storeFile = getConfig("RELEASE_STORE_FILE");

if (!storeFile) {
  console.log("Release signing secret is not configured; keeping CI validation signing.");
  process.exit(0);
}

const required = [
  "RELEASE_STORE_PASSWORD",
  "RELEASE_KEY_ALIAS",
  "RELEASE_KEY_PASSWORD",
];
const missing = required.filter((name) => !getConfig(name));
if (missing.length > 0) {
  throw new Error(`Missing release signing configuration: ${missing.join(", ")}`);
}

let gradle = await readFile(gradlePath, "utf8");
if (gradle.includes("releaseCi")) {
  console.log("Release signing configuration is already present.");
  process.exit(0);
}

const debugBlock = /(\n\s*debug\s*\{\s*storeFile file\('debug\.keystore'\)[\s\S]*?\n\s*\}\n)(\s*\})/;
if (!debugBlock.test(gradle)) {
  throw new Error("Could not locate generated debug signing configuration.");
}

gradle = gradle.replace(
  debugBlock,
  `$1        releaseCi {\n` +
    `            storeFile file(findProperty('RELEASE_STORE_FILE'))\n` +
    `            storePassword findProperty('RELEASE_STORE_PASSWORD')\n` +
    `            keyAlias findProperty('RELEASE_KEY_ALIAS')\n` +
    `            keyPassword findProperty('RELEASE_KEY_PASSWORD')\n` +
    `        }\n$2`,
);

const releaseSigning = /(\n\s*release\s*\{\s*)\n(\s*)\/\/ Caution![\s\S]*?\n\s*signingConfig signingConfigs\.debug/;
if (!releaseSigning.test(gradle)) {
  throw new Error("Could not locate generated release build type signing configuration.");
}

gradle = gradle.replace(releaseSigning, "$1\n$2signingConfig signingConfigs.releaseCi");
await writeFile(gradlePath, gradle);
console.log("Configured release signing from GitHub Actions environment properties.");
