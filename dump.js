#!/usr/bin/env node

import fetch from 'node-fetch'
import puppeteer from "puppeteer"
import { URL, URLSearchParams } from "url"
import * as fs from 'fs/promises'
import { createLogger, format, transports } from "winston"
import sanitize from 'sanitize-filename'
import path from 'path'
import { Cluster } from 'puppeteer-cluster'

// LOGGING
const log = createLogger({
    level: 'info',
    format: format.combine(
        format.timestamp({
            format: 'YYYY-MM-DD HH:mm:ss'
        }),
        format.errors({ stack: true }),
        format.json()
    ),
    defaultMeta: { service: 'confluence-offline-copy' },
    transports: [
        new transports.File({ filename: 'confluence-offline-copy.log' }),
        new transports.Console({
            format: format.combine(
                format.colorize(),
                format.simple()
            )
        })
    ]
});
// END LOGGING

async function download_attachment(api_attachment, targetDir, baseUrl, headers) {
    const downloadUrl = baseUrl + api_attachment._links.download
    const targetFilePath = targetDir + path.sep + api_attachment.title

    const attachmentDownload = await fetch(downloadUrl, { headers: headers })
    const targetFile = await fs.open(targetFilePath, "w")
    const fileStream = await targetFile.createWriteStream()
    await new Promise((resolve, reject) => {
        attachmentDownload.body.pipe(fileStream);
        attachmentDownload.body.on("error", reject);
        fileStream.on("finish", resolve);
    });
}

async function paginated_fetch(url, params = {}, headers = {}, previousResponse = []) {
    log.info(`Paginated Fetch from URL ${url} with params: ${JSON.stringify(params)}`)
    let urlParams = new URLSearchParams(params)
    urlParams.set("limit", "25")
    url.search = urlParams.toString()

    return fetch(url, { headers: headers })
        .then(response => {
            if (response.status != 200) {
                log.error(response.status + " - " + response.body)
                throw new Error(response.status)
            }
            return response.json()
        })
        .then(newResponse => {
            log.info(`Got ${newResponse.size} new results`)
            const response = [...previousResponse, ...newResponse.results];

            if (newResponse.results.size == 0) {
                let newStart = parseInt(urlParams.get("start") || "1") + parseInt(newResponse.limit)
                urlParams.set("start", newStart.toString())
                return paginated_fetch(url, urlParams, headers, response);
            }

            return response;
        })
        .catch(error => {[]})
}

async function main() {
    const start = Date.now()

    const configFile = JSON.parse(await fs.readFile("config.json", "utf8"))
    const defaultConfig = configFile.defaults
    
    for (const config of configFile.configs) {
        await workOnConfig(config, defaultConfig)
    }

    const end = Date.now()

    log.info(`Export finished, duration: ${end - start} ms`)
}

async function workOnConfig(config, defaultConfig) {
    const baseUrl = config.BASE_URL ?? defaultConfig.BASE_URL
    const headers = {
        'Authorization': config.AUTH_HEADER ?? defaultConfig.AUTH_HEADER,
    }
    const cqlSingle = config.CQL_SINGLE ?? defaultConfig.CQL_SINGLE ?? "label = \"offline-copy\""
    const cqlTree = config.CQL_TREE ?? defaultConfig.CQL_TREE ?? "label = \"offline-copy-tree\""
    const outputDir = (config.OUTPUT_DIR ?? defaultConfig.OUTPUT_DIR ?? "./output")
    const outputDirDate = outputDir + path.sep + new Date().toISOString().slice(0, 10)
    const retentionDays = config.RETENTION_DAYS ?? defaultConfig.RETENTION_DAYS ?? 10
    const concurrency = config.CONCURRENCY ?? defaultConfig.CONCURRENCY ?? 2

    log.info("Starting export...")

    // Search for relevant pages
    let searchUrl = new URL(`${baseUrl}/rest/api/search`)
    let pagesToExport = await paginated_fetch(searchUrl, {cql: cqlSingle}, headers)
    const pageTreeRoots = await paginated_fetch(searchUrl, {cql: cqlTree}, headers)

    const cluster = await Cluster.launch({
        concurrency: Cluster.CONCURRENCY_CONTEXT,
        maxConcurrency: concurrency,
        timeout: 120000,
        puppeteerOptions: {headless: true}
    });

    // Add task to export page
    await cluster.task(async ({page, data}) => {
        const {confluencePage, baseUrl, destDir, headers} = data
        
        await page.setExtraHTTPHeaders(headers)
        await page.setDefaultNavigationTimeout(0)
        await exportPage(confluencePage, baseUrl, destDir, page, headers)
    })

    // Export all pages as PDF
    for (const confluencePage of pagesToExport) {
        let destDir = outputDirDate + "/" + await getRelativeOutputDir(confluencePage)
        cluster.queue({confluencePage: confluencePage, baseUrl: baseUrl, destDir: destDir, headers: headers})
    }

    for (const pageTreeRoot of pageTreeRoots) {
        let destDir = outputDirDate + "/" + await getRelativeOutputDir(pageTreeRoot)
        cluster.queue({confluencePage: pageTreeRoot, baseUrl: baseUrl, destDir: destDir, headers: headers})
        let childPages = await paginated_fetch(searchUrl, {cql: `parent = ${pageTreeRoot.content.id}`}, headers)
        for (let childPage of childPages) {
            destDir = outputDirDate + "/" + await getRelativeOutputDir(childPage, pageTreeRoot)
            cluster.queue({confluencePage: childPage, baseUrl: baseUrl, destDir: destDir, headers: headers})
        }
    }

    // delete pages older than $RETENTION_DAYS days
    await cleanupOutputDirectory(outputDir, retentionDays)

    // Kill chrome
    await cluster.idle()
    await cluster.close()

    log.info("Export finished!")
}

async function cleanupOutputDirectory(directory, retentionDays) {
    log.info("Pruning old exports...")
    const now = Date.now()
    try {
        for (const dateDirectoryName of await fs.readdir(directory)) {
            let creationDate = Date.parse(dateDirectoryName)
            let age = now - creationDate
            const maxAge = retentionDays * 24 * 60 * 60 * 1000
            log.info(`Age: ${age}, Max Age: ${maxAge}`)
            if (age > maxAge) {
                await fs.rm(directory + path.sep + dateDirectoryName, {force: true, recursive: true})
                log.info(`Pruned old directory ${dateDirectoryName}`)
            }
        }
    } catch (error) {
        log.error(error)
    }
}

async function getRelativeOutputDir(confluencePage, rootPage = null) {
    const pageTitle = confluencePage.title
    const space = confluencePage.content._expandable.space.split('/').at(-1)

    if (rootPage) {
        const rootPageTitle = rootPage.title
        return space + "/" + sanitize(rootPageTitle) + "/" + sanitize(pageTitle)
    }
    return space + "/" + sanitize(pageTitle)
}

async function exportPage(confluencePage, baseUrl, destDir, page, headers) {
    const pageTitle = confluencePage.title
    const pageUrl = baseUrl + confluencePage.url
    const pageId = confluencePage.content.id
    const fileName = sanitize(pageTitle) + ".pdf"

    log.info(`Working on page "${pageTitle}". Saving to ${destDir}.`)

    await fs.mkdir(destDir, { recursive: true })

    // PDF Export
    await page.goto(pageUrl);
    await page.evaluate(_ => { // Expand all UI Expand macros
        $(".rwui_expand").parent().addClass("rw_open").removeClass("rw_active")
    })
    await page.pdf({
        path: `${destDir}/${fileName}`,
        format: 'A2',
        margin: { top: '10px', right: '10px', bottom: '10px', left: '10px' }
    })

    // Attachments
    log.info("Exporting attachments...");
    let attachmentsUrl = new URL(`${baseUrl}/rest/api/content/${pageId}/child/attachment`);
    const attachments = await paginated_fetch(attachmentsUrl, {}, headers);
    for (const attachment of attachments) {
        await download_attachment(attachment, destDir, baseUrl, headers);
    }
}

await main()
