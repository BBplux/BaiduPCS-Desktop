import fs from "node:fs";

const { version } = JSON.parse(fs.readFileSync("package.json", "utf8"));
const lock = JSON.parse(fs.readFileSync("package-lock.json", "utf8"));
if (
  !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/.test(
    version,
  )
)
  throw new Error(
    "Package version must be a release version without build metadata",
  );
if (lock.version !== version || lock.packages[""].version !== version)
  throw new Error("package.json and package-lock.json versions differ");
if (
  process.env.GITHUB_REF_TYPE === "tag" &&
  process.env.GITHUB_REF_NAME !== `v${version}`
)
  throw new Error(`Release tag must equal v${version}`);
console.log(`Release version verified: ${version}`);
if (process.env.GITHUB_OUTPUT)
  fs.appendFileSync(process.env.GITHUB_OUTPUT, `version=${version}\n`);
