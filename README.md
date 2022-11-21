# Confluence Offline Copy

## Requirements
* node.js
* Chrome / Chromium

## Install dependencies
```shell
npm install
```

## Preparation
Copy `config.sample.json` to config.json` and set required parameters:
* BASE_URL: The base url of the confluence instance, e.g. https://instance1.example.com/confluence
* AUTH_HEADER: The value to be set for the Authorization HTTP header on all requests, e.g. "Bearer aHR0cHM6Ly93d3cueW91dHViZS5jb20vd2F0Y2g/dj1kUXc0dzlXZ1hjUQ=="
* CQL: The CQL to use when searching for pages to be exported
* OUTPUT_DIR: Path to the directory where exported pages will be saved.
* RETENTION_DAYS: How long should exports be retained?
* CONCURRENCY: Number of concurrent headless Chromium pages

All parameters can be set on the instanc elevel or as default values that are
used when a setting is not defined at the instance level.

## Usage
```shell
node dump.js
```

## Install as Scheduled Task in Windows
Edit params in `Register-ScheduledJob.ps1` and run it. Afterwards, remove the
password from the script again.

If you don't want to have the password (temporarily) in the script, remove the
`-User` and `-Password` parameters and switch the task to `Run whether user is
logged in or not` via `taskschd.msc` afterwards. This prevents the Job from
popping up a console window with the log output.