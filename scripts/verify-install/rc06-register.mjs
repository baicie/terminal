/** Registers the RC06 resolve hook for the duration of this process. */
import { register } from 'node:module'
import { pathToFileURL } from 'node:url'
import path from 'node:path'

register(pathToFileURL(path.join(import.meta.dirname, 'rc06-loader.mjs')).href)
