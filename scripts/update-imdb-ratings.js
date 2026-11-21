const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const zlib = require('zlib');
const {
    DEFAULT_INDEX_PATH,
    createRatingsCollector,
    encodeRatingsBinary
} = require('../netlify/functions/lib/imdb-ratings-index');

const DEFAULT_SOURCE_URL = 'https://datasets.imdbws.com/title.ratings.tsv.gz';
const MAX_REDIRECTS = 5;
const DEFAULT_TIMEOUT = 60_000;

async function openResponse(sourceUrl, signal) {
    let url = new URL(sourceUrl);
    for (let redirects = 0; ; redirects += 1) {
        if (url.protocol !== 'http:' && url.protocol !== 'https:') {
            throw new Error('IMDb ratings source must use HTTP or HTTPS');
        }

        const client = url.protocol === 'https:' ? https : http;
        const response = await new Promise((resolve, reject) => {
            client.get(url, { signal }, resolve).once('error', reject);
        });
        const { statusCode, headers } = response;
        if (statusCode >= 200 && statusCode < 300) {
            return response;
        }

        response.destroy();
        if (statusCode < 300 || statusCode >= 400 || !headers.location) {
            throw new Error(`IMDb ratings source returned HTTP ${statusCode}`);
        }
        if (redirects >= MAX_REDIRECTS) {
            throw new Error(`IMDb ratings source exceeded ${MAX_REDIRECTS} redirects`);
        }
        url = new URL(headers.location, url);
    }
}

async function downloadRatings(sourceUrl, minVotes, timeout) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);
    try {
        const response = await openResponse(sourceUrl, controller.signal);
        const gunzip = zlib.createGunzip();
        const collector = createRatingsCollector(minVotes);
        response.on('error', error => gunzip.destroy(error));
        response.pipe(gunzip);
        gunzip.setEncoding('utf8');

        try {
            for await (const chunk of gunzip) {
                collector.addChunk(chunk);
            }
            return collector.finish();
        } finally {
            gunzip.destroy();
            response.destroy();
        }
    } finally {
        clearTimeout(timeoutId);
    }
}

async function buildImdbRatingsIndex(options = {}) {
    const sourceUrl = options.url ?? (process.env.IMDB_RATINGS_SOURCE_URL || DEFAULT_SOURCE_URL);
    const outputPath = path.resolve(options.outputPath ?? options.output ?? DEFAULT_INDEX_PATH);
    const tmpPath = `${outputPath}.tmp`;
    const minVotes = options.minVotes ?? 0;
    const timeout = options.timeoutMs ?? options.timeout ?? DEFAULT_TIMEOUT;

    try {
        if (!Number.isSafeInteger(minVotes) || minVotes < 0) {
            throw new Error('Minimum votes must be a nonnegative integer');
        }
        if (!Number.isInteger(timeout) || timeout < 1 || timeout > 2_147_483_647) {
            throw new Error('Timeout must be an integer from 1 to 2147483647 milliseconds');
        }

        const entries = await downloadRatings(sourceUrl, minVotes, timeout);
        if (entries.length === 0) {
            throw new Error('IMDb ratings source contained no valid records');
        }

        const generatedAtSec = Math.floor(Date.now() / 1000);
        const binary = encodeRatingsBinary(entries, generatedAtSec);
        const compressed = zlib.gzipSync(binary, { level: 9 });
        fs.mkdirSync(path.dirname(outputPath), { recursive: true });
        fs.writeFileSync(tmpPath, compressed);
        fs.renameSync(tmpPath, outputPath);
        return { ok: true, outputPath, count: binary.readUInt32LE(8) };
    } catch (error) {
        try {
            fs.rmSync(tmpPath, { force: true });
        } catch (cleanupError) {
            console.warn(`Could not remove temporary IMDb ratings index: ${cleanupError.message}`);
        }

        if (!options.allowStale) {
            throw error;
        }

        const staleUsed = fs.existsSync(outputPath);
        console.warn(`IMDb ratings update failed: ${error.message}${staleUsed ? '. Keeping the existing index.' : ''}`);
        return { ok: false, staleUsed, error };
    }
}

function parseCliArgs(args) {
    const options = {};
    for (const arg of args) {
        if (arg === '--allow-stale') {
            options.allowStale = true;
            continue;
        }

        const separator = arg.indexOf('=');
        const flag = arg.slice(0, separator);
        const value = arg.slice(separator + 1);
        if (separator === -1 || !value.trim()) {
            throw new Error(`Invalid argument: ${arg}`);
        }

        switch (flag) {
            case '--url':
                options.url = value;
                break;
            case '--output':
                options.outputPath = value;
                break;
            case '--min-votes':
                options.minVotes = Number(value);
                break;
            case '--timeout':
                options.timeoutMs = Number(value);
                break;
            default:
                throw new Error(`Unknown argument: ${flag}`);
        }
    }
    return options;
}

async function main() {
    const result = await buildImdbRatingsIndex(parseCliArgs(process.argv.slice(2)));
    if (result.ok) {
        console.log(`Wrote ${result.count} IMDb ratings to ${result.outputPath}`);
    }
}

module.exports = { buildImdbRatingsIndex };

if (require.main === module) {
    main().catch(error => {
        console.error(`IMDb ratings update failed: ${error.message}`);
        process.exitCode = 1;
    });
}
