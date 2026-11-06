#!/usr/bin/env node

const fs = require("node:fs/promises");
const path = require("node:path");

const { FRONTEND_FILES } = require("../backend/lib/frontend-files");

const ROOT = path.resolve(__dirname, "..");
const DIST = path.join(ROOT, "dist");

async function build() {
    if (DIST === ROOT) {
        throw new Error("Refusing to use the project root as dist");
    }

    await fs.rm(DIST, { recursive: true, force: true });
    await fs.mkdir(DIST, { recursive: true });

    for (const relativePath of FRONTEND_FILES) {
        const source = path.resolve(ROOT, relativePath);

        if (
            !source.startsWith(ROOT + path.sep) ||
            !FRONTEND_FILES.includes(relativePath)
        ) {
            throw new Error(
                `Refusing to copy unexpected path: ${relativePath}`
            );
        }

        const stats = await fs.stat(source);

        if (!stats.isFile()) {
            throw new Error(
                `Frontend asset is not a file: ${relativePath}`
            );
        }

        const target = path.join(DIST, relativePath);

        await fs.mkdir(path.dirname(target), {
            recursive: true
        });
        await fs.copyFile(source, target);
    }

    console.log(
        `Built ${FRONTEND_FILES.length} frontend files into dist/`
    );
}

build().catch((error) => {
    console.error(`Frontend build failed: ${error.message}`);
    process.exitCode = 1;
});
