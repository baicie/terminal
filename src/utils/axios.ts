import type { AxiosError, AxiosResponse } from 'axios'
import axios from 'axios'
import cookies from 'js-cookie'
import { getLogger } from '../hooks/use-logger'

/**
 * Extended AxiosRequestConfig with retry support
 */
interface RetryConfig {
  retry?: number
  retryDelay?: number
  __retryCount?: number
}

/**
 * @description Log and display errors
 */
function handleError(res: AxiosResponse<{ msg: string }>) {
  const logger = getLogger()
  console.error(res.data.msg)
  logger.error(res.data.msg)
}

const baseRequestConfig: axios.AxiosRequestConfig = {
  baseURL: '/api',
  timeout: 60000,
}

const service = axios.create(baseRequestConfig)

function err(err: AxiosError): Promise<AxiosResponse | AxiosError> {
  const config = err.config as axios.AxiosRequestConfig & RetryConfig | undefined
  if (!err.response && config && config.retry) {
    config.__retryCount = config.__retryCount || 0
    if (config.__retryCount >= config.retry) {
      return Promise.reject(err)
    }

    config.__retryCount += 1
    const backOff = new Promise<void>(resolve => {
      setTimeout(() => {
        resolve()
      }, config.retryDelay || 1)
    })

    return backOff.then(() => {
      return service(config)
    })
  }

  return Promise.reject(err)
}

service.interceptors.request.use(config => {
  const language = cookies.get('language')
  config.headers = config.headers || {}
  if (language) config.headers.language = language

  return config
}, err)

service.interceptors.response.use(async (res: AxiosResponse) => {
  if (res.data instanceof Blob) {
    const blobText = await res.data.text()
    if (JSON.parse(blobText).code === void 0) return res.data
    res.data = JSON.parse(blobText)
  }

  switch (res.data.statusCode) {
    case 0:
      return res.data.data
    default:
      handleError(res)
      throw new Error(`Unhandled response status: ${res.status}`)
  }
}, err)

export { service as axios }
