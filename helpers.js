const ora = require('ora')
const fs = require('fs-extra')
const { explore } = require('source-map-explorer')
const inquirer = require('inquirer')
const open = require('open')
const request = require('request-promise-native')

inquirer.registerPrompt('fuzzypath', require('inquirer-fuzzy-path'))

const visualizeBundles = ({
  bundles,
  visHTML,
  bundleFolderName,
  coverageFilePath
}) => {
  const spinner = ora(
    `Generating sourcemap visualization (this might take several minutes...)`
  ).start()

  const htmlFileName = `${__dirname}/${visHTML}`

  fs.removeSync(htmlFileName)

  explore(bundles, {
    output: {
      format: 'html',
      filename: htmlFileName
    },
    coverage: coverageFilePath
  })
    .then(() => {
      spinner.succeed()
      open(htmlFileName)
      fs.removeSync(bundleFolderName)
      console.log(
        `🎊 Done! A source map visualization should pop up in your default browser.`
      )
    })
    .catch(e => {
      spinner.fail('Failed to generate source map visualization')
      console.error(e)
    })
}

const jsURLsFromCoverage = coverage => {
  const urls = coverage
    // TODO: refine this logic
    .filter(c => /(m)?js$/.test(c.url))
    .filter(c => !/^file:/.test(c.url))
    .map(c => c.url)
  return urls
}

const initDownloadFilesFlow = ({ bundleFolderName, coverage }) => {
  let cachedResolve
  const returnedPromise = new Promise((resolve, reject) => {
    cachedResolve = resolve
  })
  const urls = jsURLsFromCoverage(coverage)

  let spinner

  inquirer
    .prompt([
      {
        type: 'checkbox',
        message: `The following files, along their sourcemaps, will be fetched. Unselect any files you do not wish to include by pressing space. When you're ready to move on, press enter.`,
        choices: urls,
        default: urls,
        name: 'files'
      }
    ])
    .then(answers => {
      spinner = ora('Downloading bundles').start()

      const dir = bundleFolderName

      fs.removeSync(dir)
      fs.mkdirSync(dir)

      const promises = []

      answers.files.map(url => {
        const fileName = url.match(fileNameRegex)[0]

        const filePromise = request({
          gzip: true,
          uri: url
        })
          .then(response => {
            fs.writeFileSync(`${bundleFolderName}/${fileName}`, response)
          })
          .catch(error => {
            console.error(`\nUnable to download: ${url}\n`)
            console.error(error)
          })

        const sourceMapPromise = request({
          gzip: true,
          uri: `${url}.map`
        })
          .then(response => {
            fs.writeFileSync(`${bundleFolderName}/${fileName}.map`, response)
          })
          .catch(error => {
            console.error(`\nUnable to download: ${url}.map\n`)
          })

        ;[].push.apply(promises, [filePromise, sourceMapPromise])
      })

      return Promise.all(promises).then(p => {
        spinner.succeed()
        cachedResolve(answers.files)
      })
    })
    .catch(e => {
      spinner.fail('Downloading bundles and sourcemaps failed')
      console.error(e)
    })
  return returnedPromise
}

const fileNameRegex = /[^/]*\.(m)?js$/

const createListOfLocalPaths = ({ files, path }) => {
  const fileNames = files
    .map(file => {
      const match = file.match(fileNameRegex)
      if (match) return match[0]
      return false
    })
    .filter(Boolean)
  const filesWithSourcemaps = fileNames
    .map(fileName => `${path}/${fileName}`)
    .filter(file => {
      const hasSourcemap = fs.existsSync(`${file}.map`)
      return hasSourcemap
    })
  return filesWithSourcemaps.concat(filesWithSourcemaps.map(f => `${f}.map`))
}

const coverageAndDownloadPrompts = ({
  shouldDownload,
  shouldNotDownload,
  argv
}) => {
  console.log('\n🧙‍  Welcome to the source map analysis wizard!\n')

  if (!argv.coverage) {
    console.log(
      "First, make sure you've downloaded a coverage report for the app entrypoint you want to analyze."
    )

    console.log(
      'You can learn more about generating a coverage report here:  https://developers.google.com/web/tools/chrome-devtools/coverage\n'
    )
  }

  return inquirer.prompt(
    [
      !argv.coverage && {
        type: 'fuzzypath',
        itemType: 'file',
        message: 'Provide the location and name of the coverage file',
        name: 'coverage',
        excludePath: nodePath => nodePath.startsWith('node_modules'),
        excludeFilter: nodePath => {
          if (!/\.json$/.test(nodePath)) return true
        }
      },
      !argv.bundles && {
        type: 'list',
        name: 'download',
        message:
          'Do the js files and sourcemaps already live in your filesystem, or do you need to download them?',
        choices: [shouldNotDownload, shouldDownload]
      }
    ].filter(Boolean)
  )
}
module.exports = {
  createListOfLocalPaths,
  visualizeBundles,
  initDownloadFilesFlow,
  coverageAndDownloadPrompts,
  jsURLsFromCoverage
}
