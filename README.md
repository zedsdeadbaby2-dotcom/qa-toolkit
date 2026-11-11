# QA Toolkit (Web)

Two QA helper tools that run entirely in the browser - plain HTML, CSS and JavaScript, no server, no build step.

| Page | What it does |
|---|---|
| `index.html` | Main page: explains both tools and links to them |
| `data-generator/` | **Test Data Generator & Store** - fictitious but valid Israeli users (name, gender, email, phone, Israeli ID), no duplicates, download as CSV, check an existing CSV |
| `log-analyzer/` | **Test Log Analyzer & Exporter** - load a TXT/LOG/CSV test log, pass/fail statistics, run times, error/warning filter, export TXT/CSV report |

Web versions of the Python CLI tools `test-data-generator` and `test-log-analyzer`.

## Run locally
Open `index.html` in a browser (double-click). Nothing to install.

## Privacy
No data leaves the browser. Files you load are read locally with the FileReader API.
