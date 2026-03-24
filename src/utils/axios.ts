import axios, { AxiosRequestConfig, AxiosResponse, AxiosError } from 'axios'
import cookies from 'js-cookie'
import { useLogger } from '../hooks/use-logger'

/**
 * @description Log and display errors
 * @param {Error} error Error object
 */
const handleError = (res: AxiosResponse<any, any>) => {
  const logger = useLogger()
  console.error(res.data.msg)
  logger.error(res.data.msg)
}

const baseRequestConfig: AxiosRequestConfig = {
  baseURL: '/api',
  timeout: 60000,
}

const service = axios.create(baseRequestConfig)

const err = (err: AxiosError): Promise<AxiosError | AxiosResponse> => {
  const config = err.config as any
  if (!err.response && config && config.retry) {
    config.__retryCount = config.__retryCount || 0
    if (config.__retryCount >= config.retry) {
      return Promise.reject(err)
    }

    config.__retryCount += 1
    const backOff = new Promise<void>(function (resolve) {
      setTimeout(function () {
        resolve()
      }, config.retryDelay || 1)
    })

    return backOff.then(function () {
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
      throw new Error()
  }
}, err)

export { service as axios }
