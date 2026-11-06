/* CampusFix service worker: cache static assets only. API and auth responses are never cached. */
"use strict";

const CACHE_NAME = "campusfix-static-v2";
const OFFLINE_URL = "./offline.html";
const PRECACHE_URLS = [
    OFFLINE_URL,
    "./style.css",
    "./manifest.webmanifest",
    "./js/icons.js",
    "./js/i18n.js",
    "./js/session.js",
    "./js/shell.js",
    "./icons/icon-192.png",
    "./icons/icon-512.png",
    "./icons/maskable-512.png"
].map((path) => new URL(path, self.location.href).href);

self.addEventListener("install", (event) => {
    event.waitUntil(
        caches
            .open(CACHE_NAME)
            .then((cache) => cache.addAll(PRECACHE_URLS))
            .then(() => self.skipWaiting())
    );
});

self.addEventListener("activate", (event) => {
    event.waitUntil(
        caches
            .keys()
            .then((keys) =>
                Promise.all(
                    keys
                        .filter(
                            (key) =>
                                key.startsWith("campusfix-") &&
                                key !== CACHE_NAME
                        )
                        .map((key) => caches.delete(key))
                )
            )
            .then(() => self.clients.claim())
    );
});

function isApiRequest(url) {
    return (
        url.pathname === "/api" ||
        url.pathname.startsWith("/api/")
    );
}

async function staleWhileRevalidate(request) {
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(request);
    const network = fetch(request)
        .then((response) => {
            if (
                response &&
                response.ok &&
                response.type === "basic"
            ) {
                cache.put(request, response.clone());
            }

            return response;
        })
        .catch(() => null);

    return cached || network || Response.error();
}

async function navigationResponse(request) {
    try {
        const response = await fetch(request);

        if (response && response.ok) {
            return response;
        }

        throw new Error("Navigation request failed");
    } catch (error) {
        const cache = await caches.open(CACHE_NAME);
        const offline = await cache.match(OFFLINE_URL);

        return (
            offline ||
            new Response(
                "<!doctype html><title>Offline</title><p>CampusFix is offline. Reconnect and try again.</p>",
                {
                    status: 503,
                    headers: {
                        "Content-Type": "text/html; charset=utf-8"
                    }
                }
            )
        );
    }
}

self.addEventListener("fetch", (event) => {
    const request = event.request;

    if (request.method !== "GET") {
        return;
    }

    const url = new URL(request.url);

    if (url.origin !== self.location.origin) {
        return;
    }

    if (isApiRequest(url)) {
        return;
    }

    if (request.mode === "navigate") {
        event.respondWith(navigationResponse(request));
        return;
    }

    if (
        ["script", "style", "image", "manifest"].includes(
            request.destination
        )
    ) {
        event.respondWith(staleWhileRevalidate(request));
    }
});
