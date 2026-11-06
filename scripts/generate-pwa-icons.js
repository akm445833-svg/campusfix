#!/usr/bin/env node
"use strict";

/*
 * Generates the CampusFix PWA icons without external image libraries.
 * The artwork is rasterised from primitives at 4x and box-filtered down.
 */

const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");

const OUT_DIR = path.resolve(__dirname, "..", "icons");
const SUPER_SAMPLE = 4;
const DESIGN = 512;

const COLORS = {
    navy: [11, 31, 56, 255],
    deep: [7, 17, 31, 255],
    top: [20, 58, 104, 255],
    glow: [29, 78, 216, 255],
    blue: [59, 130, 246, 255],
    white: [255, 255, 255, 255],
    charcoal: [13, 36, 64, 255]
};

function createCanvas(size) {
    return {
        width: size,
        height: size,
        data: new Uint8ClampedArray(size * size * 4)
    };
}

function blendPixel(canvas, x, y, color) {
    if (x < 0 || y < 0 || x >= canvas.width || y >= canvas.height) {
        return;
    }

    const index = (y * canvas.width + x) * 4;
    const data = canvas.data;
    const alpha = color[3] / 255;
    const inverse = 1 - alpha;

    data[index] = color[0] * alpha + data[index] * inverse;
    data[index + 1] = color[1] * alpha + data[index + 1] * inverse;
    data[index + 2] = color[2] * alpha + data[index + 2] * inverse;
    data[index + 3] = Math.max(
        color[3],
        data[index + 3] * inverse + color[3] * alpha
    );
}

function fillCircle(canvas, cx, cy, radius, color) {
    const minX = Math.max(0, Math.floor(cx - radius));
    const maxX = Math.min(canvas.width - 1, Math.ceil(cx + radius));
    const minY = Math.max(0, Math.floor(cy - radius));
    const maxY = Math.min(canvas.height - 1, Math.ceil(cy + radius));
    const squared = radius * radius;

    for (let y = minY; y <= maxY; y += 1) {
        for (let x = minX; x <= maxX; x += 1) {
            const dx = x + 0.5 - cx;
            const dy = y + 0.5 - cy;

            if (dx * dx + dy * dy <= squared) {
                blendPixel(canvas, x, y, color);
            }
        }
    }
}

function insideRoundedRect(x, y, left, top, width, height, radius) {
    if (x < left || y < top || x > left + width || y > top + height) {
        return false;
    }

    const clampedX = Math.min(Math.max(x, left + radius), left + width - radius);
    const clampedY = Math.min(Math.max(y, top + radius), top + height - radius);
    const dx = x - clampedX;
    const dy = y - clampedY;

    return dx * dx + dy * dy <= radius * radius;
}

function fillRoundedRect(canvas, left, top, width, height, radius, color) {
    const minX = Math.max(0, Math.floor(left));
    const maxX = Math.min(canvas.width - 1, Math.ceil(left + width));
    const minY = Math.max(0, Math.floor(top));
    const maxY = Math.min(canvas.height - 1, Math.ceil(top + height));

    for (let y = minY; y <= maxY; y += 1) {
        for (let x = minX; x <= maxX; x += 1) {
            if (
                insideRoundedRect(
                    x + 0.5,
                    y + 0.5,
                    left,
                    top,
                    width,
                    height,
                    radius
                )
            ) {
                blendPixel(canvas, x, y, color);
            }
        }
    }
}

function fillTriangle(canvas, a, b, c, color) {
    const minX = Math.max(0, Math.floor(Math.min(a[0], b[0], c[0])));
    const maxX = Math.min(
        canvas.width - 1,
        Math.ceil(Math.max(a[0], b[0], c[0]))
    );
    const minY = Math.max(0, Math.floor(Math.min(a[1], b[1], c[1])));
    const maxY = Math.min(
        canvas.height - 1,
        Math.ceil(Math.max(a[1], b[1], c[1]))
    );

    function edge(p, q, x, y) {
        return (q[0] - p[0]) * (y - p[1]) - (q[1] - p[1]) * (x - p[0]);
    }

    for (let y = minY; y <= maxY; y += 1) {
        for (let x = minX; x <= maxX; x += 1) {
            const px = x + 0.5;
            const py = y + 0.5;
            const w0 = edge(a, b, px, py);
            const w1 = edge(b, c, px, py);
            const w2 = edge(c, a, px, py);

            if (
                (w0 >= 0 && w1 >= 0 && w2 >= 0) ||
                (w0 <= 0 && w1 <= 0 && w2 <= 0)
            ) {
                blendPixel(canvas, x, y, color);
            }
        }
    }
}

function drawLine(canvas, points, width, color) {
    const radius = width / 2;

    for (let index = 0; index < points.length - 1; index += 1) {
        const [x1, y1] = points[index];
        const [x2, y2] = points[index + 1];
        const dx = x2 - x1;
        const dy = y2 - y1;
        const lengthSquared = dx * dx + dy * dy;
        const minX = Math.max(0, Math.floor(Math.min(x1, x2) - radius));
        const maxX = Math.min(
            canvas.width - 1,
            Math.ceil(Math.max(x1, x2) + radius)
        );
        const minY = Math.max(0, Math.floor(Math.min(y1, y2) - radius));
        const maxY = Math.min(
            canvas.height - 1,
            Math.ceil(Math.max(y1, y2) + radius)
        );

        for (let y = minY; y <= maxY; y += 1) {
            for (let x = minX; x <= maxX; x += 1) {
                const px = x + 0.5 - x1;
                const py = y + 0.5 - y1;
                const t = Math.max(
                    0,
                    Math.min(1, (px * dx + py * dy) / lengthSquared)
                );
                const closestX = t * dx - px;
                const closestY = t * dy - py;

                if (
                    closestX * closestX + closestY * closestY <=
                    radius * radius
                ) {
                    blendPixel(canvas, x, y, color);
                }
            }
        }
    }

    for (const [x, y] of points) {
        fillCircle(canvas, x, y, radius, color);
    }
}

function paintBackground(canvas, rounded) {
    const size = canvas.width;
    const radius = 112 * (size / DESIGN);
    const glowX = size * 0.24;
    const glowY = size * 0.16;
    const glowRadius = size * 0.62;

    for (let y = 0; y < size; y += 1) {
        for (let x = 0; x < size; x += 1) {
            if (
                rounded &&
                !insideRoundedRect(x + 0.5, y + 0.5, 0, 0, size, size, radius)
            ) {
                continue;
            }

            const progress = (x + y) / (size * 2);
            const base = [0, 0, 0, 255];

            for (let channel = 0; channel < 3; channel += 1) {
                base[channel] = Math.round(
                    COLORS.top[channel] * (1 - progress) +
                        COLORS.deep[channel] * progress
                );
            }

            const dx = x - glowX;
            const dy = y - glowY;
            const distance = Math.sqrt(dx * dx + dy * dy);
            const falloff = Math.max(0, 1 - distance / glowRadius);

            if (falloff > 0) {
                const strength = falloff * falloff * 0.28;

                for (let channel = 0; channel < 3; channel += 1) {
                    base[channel] = Math.round(
                        base[channel] * (1 - strength) +
                            COLORS.glow[channel] * strength
                    );
                }
            }

            const index = (y * size + x) * 4;
            canvas.data[index] = base[0];
            canvas.data[index + 1] = base[1];
            canvas.data[index + 2] = base[2];
            canvas.data[index + 3] = 255;
        }
    }
}

function paintEmblem(canvas, maskable) {
    const size = canvas.width;
    const scale = (size / DESIGN) * (maskable ? 0.72 : 0.86);
    const offsetY = maskable ? 0 : -10 * (size / DESIGN);
    const origin = size / 2;

    function project(x, y) {
        return [
            origin + (x - DESIGN / 2) * scale,
            origin + (y - DESIGN / 2) * scale + offsetY
        ];
    }

    const white = COLORS.white;
    const navy = COLORS.navy;
    const body = project(146, 188);

    fillTriangle(
        canvas,
        project(256, 88),
        project(116, 206),
        project(396, 206),
        white
    );
    fillRoundedRect(
        canvas,
        body[0],
        body[1],
        220 * scale,
        226 * scale,
        16 * scale,
        white
    );

    // Door and windows are cut out by painting the background navy.
    fillRoundedRect(
        canvas,
        project(230, 316)[0],
        project(230, 316)[1],
        52 * scale,
        98 * scale,
        9 * scale,
        COLORS.charcoal
    );

    for (const windowX of [188, 288]) {
        fillRoundedRect(
            canvas,
            project(windowX, 244)[0],
            project(windowX, 244)[1],
            38 * scale,
            38 * scale,
            8 * scale,
            COLORS.charcoal
        );
    }

    // Completion badge.
    const badgeCenter = project(374, 378);
    fillCircle(canvas, badgeCenter[0], badgeCenter[1], 94 * scale, navy);
    fillCircle(canvas, badgeCenter[0], badgeCenter[1], 78 * scale, COLORS.blue);
    drawLine(
        canvas,
        [
            project(336, 378),
            project(364, 406),
            project(412, 352)
        ],
        20 * scale,
        white
    );
}

function downsample(canvas, targetSize) {
    const factor = canvas.width / targetSize;
    const output = createCanvas(targetSize);

    for (let y = 0; y < targetSize; y += 1) {
        for (let x = 0; x < targetSize; x += 1) {
            let alpha = 0;
            let red = 0;
            let green = 0;
            let blue = 0;

            for (let sy = 0; sy < factor; sy += 1) {
                for (let sx = 0; sx < factor; sx += 1) {
                    const index =
                        ((y * factor + sy) * canvas.width +
                            (x * factor + sx)) *
                        4;
                    const a = canvas.data[index + 3] / 255;

                    alpha += a;
                    red += canvas.data[index] * a;
                    green += canvas.data[index + 1] * a;
                    blue += canvas.data[index + 2] * a;
                }
            }

            const index = (y * targetSize + x) * 4;

            if (alpha > 0) {
                output.data[index] = Math.round(red / alpha);
                output.data[index + 1] = Math.round(green / alpha);
                output.data[index + 2] = Math.round(blue / alpha);
            }

            output.data[index + 3] = Math.round(
                (alpha / (factor * factor)) * 255
            );
        }
    }

    return output;
}

const CRC_TABLE = (() => {
    const table = new Uint32Array(256);

    for (let n = 0; n < 256; n += 1) {
        let value = n;

        for (let k = 0; k < 8; k += 1) {
            value =
                value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
        }

        table[n] = value >>> 0;
    }

    return table;
})();

function crc32(buffer) {
    let crc = 0xffffffff;

    for (const byte of buffer) {
        crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
    }

    return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
    const typeBuffer = Buffer.from(type, "ascii");
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length, 0);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0);

    return Buffer.concat([length, typeBuffer, data, crc]);
}

function encodePng(canvas) {
    const header = Buffer.alloc(13);
    header.writeUInt32BE(canvas.width, 0);
    header.writeUInt32BE(canvas.height, 4);
    header[8] = 8;
    header[9] = 6;
    header[10] = 0;
    header[11] = 0;
    header[12] = 0;

    const rowLength = canvas.width * 4;
    const raw = Buffer.alloc((rowLength + 1) * canvas.height);

    for (let y = 0; y < canvas.height; y += 1) {
        raw[y * (rowLength + 1)] = 0;
        Buffer.from(
            canvas.data.buffer,
            y * rowLength,
            rowLength
        ).copy(raw, y * (rowLength + 1) + 1);
    }

    return Buffer.concat([
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        chunk("IHDR", header),
        chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
        chunk("IEND", Buffer.alloc(0))
    ]);
}

function render(size, { maskable = false, rounded = !maskable } = {}) {
    const canvas = createCanvas(size * SUPER_SAMPLE);
    paintBackground(canvas, rounded);
    paintEmblem(canvas, maskable);

    return downsample(canvas, size);
}

function writeIcon(name, size, options) {
    const target = path.join(OUT_DIR, name);

    fs.writeFileSync(target, encodePng(render(size, options)));
    console.log(`Wrote ${path.relative(process.cwd(), target)} (${size}px)`);
}

fs.mkdirSync(OUT_DIR, { recursive: true });
writeIcon("icon-192.png", 192);
writeIcon("icon-512.png", 512);
writeIcon("maskable-512.png", 512, { maskable: true });
