# Check Drupal Patches

## Introduction

In case you're building Drupal projects using Composer you're probably
managing code patches using the [composer-patches](https://github.com/cweagans/composer-patches)
plugin by cweagans.

Check Drupal Patches is a command line tool to check your patch list against
multiple releases of your dependencies (Drupal core and contributed packages).
For each dependency release it will tell you whether a given patch has been applied,
is applicable or can't be applied.

No modifications are made to your project folder.

## Requirements

* NodeJS >=12.0.0
* Git
* Composer

## Installation

You should install this tool globally:

```
npm install -g check-drupal-patches
```

## Usage

Start the scan specifying your Drupal project root folder, relative or absolute:
```
cdp <Drupal Project Root>
```
The project root is the folder containing your composer.json file, usually
one level above the web root containing the index.php file.

Be aware the scan might take quite some time. The reason is that your
dependencies will be installed to a temporary folder from source, so
there will be a complete git history.

## TODO

For now, this tool is kind of a POC and needs definitely more testing. There will be bugs for sure. Feel free to open issues (good) and pull requests (better).

At the moment there's no way to check development versions of dependencies.

## Changelog

**v0.1.1**
Fixed a typo

**v0.1.0**
Initial release

## License: MIT