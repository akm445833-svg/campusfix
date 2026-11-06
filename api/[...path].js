"use strict";

const HOP_BY_HOP_HEADERS = new Set([
    "connection",
    "keep-alive",
    "proxy-authenticate",
    "proxy-authorization",
    "te",
    "trailer",
    "transfer-encoding",
    "upgrade",
    "content-encoding",
    "content-length",
    "set-cookie"
]);

const API_PATH_PATTERN = /^\/api(?:\/[A-Za-z0-9/_-]*)?$/;
const REQUEST_TIMEOUT_MS = 90000;

function parseBackendBase(value) {
    let base;

    try {
        base = new URL(String(value || ""));
    } catch (error) {
        return null;
    }

    if (!["https:", "http:"].includes(base.protocol)) {
        return null;
    }

    if (base.username || base.password) {
        return null;
    }

    const localHostnames = new Set([
        "localhost",
        "127.0.0.1",
        "::1"
    ]);

    if (
        base.protocol !== "https:" &&
        !localHostnames.has(base.hostname)
    ) {
        return null;
    }

    if (base.pathname !== "/" || base.search || base.hash) {
        return null;
    }

    return base;
}

function requestBody(body) {
    if (body === undefined || body === null) {
        return undefined;
    }

    if (Buffer.isBuffer(body)) {
        return body;
    }

    if (typeof body === "string") {
        return body;
    }

    return JSON.stringify(body);
}

function firstHeader(value) {
    return Array.isArray(value) ? value[0] : value;
}

function sanitizeCookie(cookie) {
    return cookie.replace(/;\s*domain=[^;]*/gi, "");
}

module.exports = async function proxy(req, res) {
    const backend = parseBackendBase(process.env.BACKEND_URL);

    if (!backend) {
        res.statusCode = 503;
        res.setHeader("Content-Type", "application/json");
        res.end(
            JSON.stringify({
                message: "Backend URL is not configured"
            })
        );
        return;
    }

    let incoming;

    try {
        incoming = new URL(req.url || "/", "http://proxy.local");
    } catch (error) {
        res.statusCode = 400;
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ message: "Invalid request URL" }));
        return;
    }

    let pathname;

    try {
        pathname = decodeURIComponent(incoming.pathname);
    } catch (error) {
        res.statusCode = 400;
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ message: "Invalid request path" }));
        return;
    }

    if (
        !API_PATH_PATTERN.test(pathname) ||
        pathname.includes("//") ||
        pathname.includes("..") ||
        pathname.includes("\\")
    ) {
        res.statusCode = 404;
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ message: "API route not found" }));
        return;
    }

    const target = new URL(pathname + incoming.search, backend);

    if (target.hostname !== backend.hostname) {
        res.statusCode = 400;
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ message: "Invalid proxy target" }));
        return;
    }

    const headers = {
        accept: firstHeader(req.headers.accept) || "application/json"
    };

    for (const name of [
        "authorization",
        "content-type",
        "cookie",
        "origin",
        "referer"
    ]) {
        const value = firstHeader(req.headers[name]);

        if (value) {
            headers[name] = value;
        }
    }

    const clientIp = firstHeader(req.headers["x-forwarded-for"]);

    if (clientIp) {
        headers["x-forwarded-for"] = clientIp;
    }

    headers["x-forwarded-proto"] = "https";
    headers["x-forwarded-host"] =
        firstHeader(req.headers.host) || "";

    let body;

    try {
        // Vercel populates req.body lazily and can throw on bad JSON.
        body = requestBody(req.body);
    } catch (error) {
        res.statusCode = 400;
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ message: "Invalid JSON body" }));
        return;
    }

    let upstream;

    try {
        upstream = await fetch(target, {
            method: req.method,
            headers,
            body,
            redirect: "manual",
            signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
        });
    } catch (error) {
        const timedOut =
            error && (error.name === "TimeoutError" ||
                error.name === "AbortError");

        console.error(
            timedOut
                ? "API proxy timed out"
                : "API proxy connection failed"
        );

        res.statusCode = timedOut ? 504 : 502;
        res.setHeader("Content-Type", "application/json");
        res.end(
            JSON.stringify({
                message: timedOut
                    ? "Backend timed out. Please try again."
                    : "Cannot connect to CampusFix backend."
            })
        );
        return;
    }

    const buffer = Buffer.from(await upstream.arrayBuffer());

    upstream.headers.forEach((value, name) => {
        if (
            !HOP_BY_HOP_HEADERS.has(name) &&
            name !== "content-type"
        ) {
            res.setHeader(name, value);
        }
    });

    const contentType = upstream.headers.get("content-type");

    if (contentType) {
        res.setHeader("Content-Type", contentType);
    }

    const cookies =
        typeof upstream.headers.getSetCookie === "function"
            ? upstream.headers.getSetCookie()
            : [];

    if (cookies.length > 0) {
        res.setHeader("Set-Cookie", cookies.map(sanitizeCookie));
    }

    res.setHeader("Cache-Control", "no-store");
    res.statusCode = upstream.status;

    if (
        upstream.status === 204 ||
        upstream.status === 304 ||
        req.method === "HEAD"
    ) {
        res.end();
        return;
    }

    res.end(buffer);
};
