const chromeLauncher = require('chrome-launcher')
const puppeteer = require('puppeteer-core')
const devices = require('puppeteer-core/DeviceDescriptors')
const request = require('request')
const util = require('util')
const fs = require('fs')
const { Input } = require('enquirer')
const { delay } = require('./helpers')

const launchBrowser = async ({ interact, isMobile }) => {
  const opts = {
    chromeFlags: interact ? [] : ['--headless'],
    logLevel: global.debug ? 'info' : 'error',
    output: 'json'
  }
  try {
    const chrome = await chromeLauncher.launch(opts)
    opts.port = chrome.port

    const resp = await util.promisify(request)(
      `http://localhost:${opts.port}/json/version`
    )
    const { webSocketDebuggerUrl } = JSON.parse(resp.body)

    const browser = await puppeteer.connect({
      browserWSEndpoint: webSocketDebuggerUrl,
      isMobile
    })
    return [chrome, browser]
  } catch (e) {
    console.error('❌  Unable to launch Chrome:\n')
    console.error(e)
    process.exit(1)
  }
}

const validateURL = url => {
  if (!/^http/.test(url)) {
    url = `https://${url}`
    return url
  }
  try {
    new URL(url)
    return url
  } catch (e) {
    console.error(
      `❌  The provided url: ${url} is not valid, please try again.`
    )
    return false
  }
}

const promptForURL = async () => {
  const url = await new Input({
    message: `Which site would you like to analyze?`,
    initial: 'https://reddit.com'
  }).run()

  const validUrl = validateURL(url)
  if (validUrl) {
    return validUrl
  } else {
    process.exit(9)
  }
}

const downloadCoverage = async ({
  url,
  type,
  interact,
  downloadsDir,
  coverageFilePath,
  tempFolderName
}) => {
  if (!url) {
    url = await promptForURL()
    console.log('\n')
  } else {
    url = validateURL(url)
  }

  console.log(`🤖  Recording page load info for ${url} ...`)

  const isMobile = type === 'mobile'

  const [chrome, browser] = await launchBrowser({ interact, isMobile })

  const page = await (await browser.pages())[0]

  if (isMobile) {
    await page.emulate(devices['iPhone X'])
  }

  const urlToFileDict = {}

  page.on('response', response => {
    const url = new URL(response.url())
    const fileName = url.pathname.split('/').slice(-1)[0]
    const isJSFile = fileName.match(/\.(m)?js$/)
    if (!isJSFile) return
    response.text().then(body => {
      const localFileName = `${downloadsDir}/${fileName}`
      urlToFileDict[url.toString()] = localFileName
      fs.writeFileSync(localFileName, body)
    })
  })

  await page.coverage.startJSCoverage()
  await page.goto(url)

  const completeCoverage = async () => {
    console.log('🤖  Writing coverage file to disk...')
    const jsCoverage = await page.coverage.stopJSCoverage()
    fs.writeFileSync(coverageFilePath, JSON.stringify(jsCoverage))
    await browser.close()
    await chrome.kill()
    return { urlToFileDict, url }
  }

  return new Promise(async resolve => {
    if (interact) {
      browser.on('disconnected', async () => {
        resolve(await completeCoverage())
      })
      console.log(
        '\n💻  A browser window should have opened that you can interact with.\n'
      )
      console.log('\n💻  Close the browser window to continue.\n')
    } else {
      console.log('\n🤖  Finishing up recording...\n')
      // allow page to make any errant http requests.
      // this might not be super necessary
      await delay(3000)
      await page.screenshot({ path: `${tempFolderName}/screenshot.png` })

      resolve(await completeCoverage())
    }
  })
}

module.exports = downloadCoverage
