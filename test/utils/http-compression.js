'use strict'

const http = require('node:http')
const { brotliDecompressSync, gunzipSync, inflateSync } = require('node:zlib')

async function listenOnRandomPort(app) {
    if (!app.server.listening) {
        await app.listen({ port: 0, host: '127.0.0.1' })
    }

    return app.server.address().port
}

function decodeResponseBody(rawBody, contentEncoding) {
    if (!contentEncoding) {
        return rawBody
    }

    if (contentEncoding === 'gzip') {
        return gunzipSync(rawBody)
    }

    if (contentEncoding === 'br') {
        return brotliDecompressSync(rawBody)
    }

    if (contentEncoding === 'deflate') {
        return inflateSync(rawBody)
    }

    throw new Error(`Unexpected content-encoding: ${contentEncoding}`)
}

async function getCompressedResponse({ port, path, accessToken, encoding }) {
    return await new Promise((resolve, reject) => {
        const request = http.request(
            {
                hostname: '127.0.0.1',
                port,
                path,
                method: 'GET',
                headers: {
                    Authorization: `Bearer ${accessToken}`,
                    'Accept-Encoding': encoding,
                },
            },
            (response) => {
                const chunks = []

                response.on('data', (chunk) => {
                    chunks.push(chunk)
                })

                response.on('end', () => {
                    const rawBody = Buffer.concat(chunks)
                    const contentEncoding = response.headers['content-encoding']

                    resolve({
                        statusCode: response.statusCode,
                        headers: response.headers,
                        rawBody,
                        body: decodeResponseBody(rawBody, contentEncoding).toString('utf8'),
                    })
                })
            },
        )

        request.on('error', reject)
        request.end()
    })
}

async function getGzipResponse(options) {
    return await getCompressedResponse({ ...options, encoding: 'gzip' })
}

async function getBrotliResponse(options) {
    return await getCompressedResponse({ ...options, encoding: 'br' })
}

async function getDeflateResponse(options) {
    return await getCompressedResponse({ ...options, encoding: 'deflate' })
}

module.exports = {
    getBrotliResponse,
    getCompressedResponse,
    getDeflateResponse,
    getGzipResponse,
    listenOnRandomPort,
}