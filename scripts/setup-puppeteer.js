// Puppeteer setup script for local and deployment environments
const fs = require("fs");
const path = require("path");
const os = require("os");
const { spawnSync } = require("child_process");

function log(message) {
  console.log(`[puppeteer] ${message}`);
}

function ensureDirectory(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function getPuppeteerCacheDir() {
  return (
    process.env.PUPPETEER_CACHE_DIR ||
    path.join(process.cwd(), ".cache", "puppeteer")
  );
}

function findSystemBrowserExecutable() {
  const candidates = [];

  if (process.platform === "win32") {
    candidates.push(
      "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    );
    candidates.push(
      "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    );
    candidates.push("C:\\Program Files\\Chromium\\Application\\chrome.exe");
  } else {
    candidates.push("/usr/bin/google-chrome");
    candidates.push("/usr/bin/google-chrome-stable");
    candidates.push("/usr/bin/chromium");
    candidates.push("/usr/bin/chromium-browser");
  }

  for (const candidate of candidates) {
    if (
      candidate &&
      fs.existsSync(candidate) &&
      fs.statSync(candidate).isFile()
    ) {
      return candidate;
    }
  }

  return null;
}

function findBrowserExecutable(cacheDir) {
  const candidates = [];

  if (process.platform === "win32") {
    candidates.push(
      path.join(cacheDir, "chrome", "win64-*/chrome-win64/chrome.exe"),
    );
    candidates.push(
      path.join(cacheDir, "chrome", "win64-*/chrome-win64/chrome"),
    );
    candidates.push(
      path.join(
        cacheDir,
        "chrome-headless-shell",
        "win64-*/chrome-headless-shell-win64/chrome-headless-shell.exe",
      ),
    );
    candidates.push(
      path.join(
        cacheDir,
        "chrome-headless-shell",
        "win64-*/chrome-headless-shell-win64/chrome-headless-shell",
      ),
    );
    candidates.push(
      path.join(cacheDir, "chromium", "win64-*/chrome-win64/chrome.exe"),
    );
  } else {
    candidates.push(path.join(cacheDir, "chrome", "*/chrome-linux*/chrome"));
    candidates.push(
      path.join(cacheDir, "chrome-headless-shell", "*/chrome-headless-shell"),
    );
    candidates.push(path.join(cacheDir, "chromium", "*/chrome-linux*/chrome"));
  }

  for (const pattern of candidates) {
    const resolvedPattern = pattern.replace(/\\/g, path.sep);
    const baseDir = path.dirname(resolvedPattern);
    if (!fs.existsSync(baseDir)) continue;

    try {
      const entries = fs.readdirSync(baseDir, { withFileTypes: true });
      for (const entry of entries) {
        const candidatePath = path.join(baseDir, entry.name);
        if (!entry.isDirectory()) continue;

        const possiblePaths = [];
        if (process.platform === "win32") {
          possiblePaths.push(
            path.join(candidatePath, "chrome-win64", "chrome.exe"),
          );
          possiblePaths.push(
            path.join(candidatePath, "chrome-win64", "chrome"),
          );
          possiblePaths.push(
            path.join(
              candidatePath,
              "chrome-headless-shell-win64",
              "chrome-headless-shell.exe",
            ),
          );
          possiblePaths.push(
            path.join(
              candidatePath,
              "chrome-headless-shell-win64",
              "chrome-headless-shell",
            ),
          );
          possiblePaths.push(
            path.join(
              candidatePath,
              "chrome-headless-shell",
              "chrome-headless-shell.exe",
            ),
          );
        } else {
          possiblePaths.push(
            path.join(candidatePath, "chrome-linux", "chrome"),
          );
          possiblePaths.push(
            path.join(candidatePath, "chrome-linux64", "chrome"),
          );
          possiblePaths.push(path.join(candidatePath, "chrome-headless-shell"));
        }

        for (const possiblePath of possiblePaths) {
          if (
            fs.existsSync(possiblePath) &&
            fs.statSync(possiblePath).isFile()
          ) {
            return possiblePath;
          }
        }
      }
    } catch (error) {
      // Ignore and continue scanning.
    }
  }

  return null;
}

function removeBrokenInstallDirs(cacheDir) {
  const namesToClean = ["chrome", "chrome-headless-shell", "chromium"];
  for (const name of namesToClean) {
    const browserDir = path.join(cacheDir, name);
    if (!fs.existsSync(browserDir)) continue;

    try {
      const entries = fs.readdirSync(browserDir, { withFileTypes: true });
      for (const entry of entries) {
        const entryPath = path.join(browserDir, entry.name);
        if (!entry.isDirectory()) continue;

        const executableCandidates =
          process.platform === "win32"
            ? [
                path.join(entryPath, "chrome-win64", "chrome.exe"),
                path.join(entryPath, "chrome-win64", "chrome"),
                path.join(
                  entryPath,
                  "chrome-headless-shell-win64",
                  "chrome-headless-shell.exe",
                ),
                path.join(
                  entryPath,
                  "chrome-headless-shell-win64",
                  "chrome-headless-shell",
                ),
                path.join(
                  entryPath,
                  "chrome-headless-shell",
                  "chrome-headless-shell.exe",
                ),
              ]
            : [
                path.join(entryPath, "chrome-linux", "chrome"),
                path.join(entryPath, "chrome-linux64", "chrome"),
                path.join(entryPath, "chrome-headless-shell"),
              ];

        const hasValidBinary = executableCandidates.some(
          (candidate) =>
            fs.existsSync(candidate) && fs.statSync(candidate).isFile(),
        );
        if (!hasValidBinary) {
          fs.rmSync(entryPath, { recursive: true, force: true });
          log(
            `Removed incomplete Puppeteer browser cache directory: ${entryPath}`,
          );
        }
      }
    } catch (error) {
      log(
        `Could not inspect Puppeteer cache directory ${browserDir}: ${error.message}`,
      );
    }
  }
}

function runInstall(browser) {
  log(`Attempting to install Puppeteer browser: ${browser}`);
  const result = spawnSync(
    "npx",
    ["puppeteer", "browsers", "install", browser],
    {
      stdio: "inherit",
      shell: true,
      env: { ...process.env },
    },
  );

  return result.status === 0;
}

function main() {
  const cacheDir = getPuppeteerCacheDir();
  const cacheRoot = path.dirname(cacheDir);
  ensureDirectory(cacheRoot);
  ensureDirectory(cacheDir);

  log(`Using Puppeteer cache directory: ${cacheDir}`);
  log(
    `PUPPETEER_EXECUTABLE_PATH: ${process.env.PUPPETEER_EXECUTABLE_PATH || "Not set"}`,
  );
  log(`PUPPETEER_CACHE_DIR: ${process.env.PUPPETEER_CACHE_DIR || "Not set"}`);

  const configuredExecutable = process.env.PUPPETEER_EXECUTABLE_PATH;
  if (configuredExecutable && fs.existsSync(configuredExecutable)) {
    log(`Using configured Puppeteer executable: ${configuredExecutable}`);
    return;
  }

  const systemBrowser = findSystemBrowserExecutable();
  if (systemBrowser) {
    process.env.PUPPETEER_EXECUTABLE_PATH = systemBrowser;
    log(`Using system browser executable: ${systemBrowser}`);
    return;
  }

  const existingBrowser = findBrowserExecutable(cacheDir);
  if (existingBrowser) {
    log(`Found usable browser executable: ${existingBrowser}`);
    return;
  }

  const attempts = ["chrome", "chrome-headless-shell", "chromium"];
  let installed = false;

  for (const browser of attempts) {
    removeBrokenInstallDirs(cacheDir);
    const success = runInstall(browser);
    if (success) {
      const browserExecutable = findBrowserExecutable(cacheDir);
      if (browserExecutable) {
        log(`Installed browser executable: ${browserExecutable}`);
        installed = true;
        break;
      }
    }
    log(
      `Browser install attempt for ${browser} did not produce a usable executable.`,
    );
  }

  if (!installed) {
    log(
      "Puppeteer browser installation could not be completed. Continuing so npm install can finish; the browser can be installed later if needed.",
    );
  }
}

main();
