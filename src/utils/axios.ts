import axios, { AxiosRequestConfig, AxiosResponse, AxiosError } from 'axios'
import _ from 'lodash'
import cookies from 'js-cookie'
import { message } from 'antd'
import { useLogger } from '../hooks/use-logger'
// import router from '@/router'
// import utils from '@/utils'
// import isJson from '@/utils/json'
// import { useTokenStore } from '@/store/token'

/**
 * @description Log and display errors
 * @param {Error} error Error object
 */
const handleError = (res: AxiosResponse<any, any>) => {
  // Print to console
  const logger = useLogger()
  message.destroy()
  message.error(res.data.msg)
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
      // Reject with the error
      return Promise.reject(err)
    }

    config.__retryCount += 1
    // Create new promise to handle exponential back off
    const backOff = new Promise<void>(function (resolve) {
      setTimeout(function () {
        resolve()
      }, config.retryDelay || 1)
    })

    // Return the promise in which recalls axios to retry the request
    return backOff.then(function () {
      return service(config)
    })
  }

  //   const userStore = useUserStore()
  //   const tokenStore = useTokenStore()
  //   if (err.response?.status === 401) {
  //     tokenStore.cleanToken()
  //   }
  //   if (err.response?.status === 401 || err.response?.status === 504) {
  //     userStore.setSessionId('')
  //     userStore.setUserInfo()
  //     router.push({ path: '/login' })
  //   }

  return Promise.reject(err)
}

service.interceptors.request.use((config) => {
  //   const userStore = useUserStore()
  //   const tokenStore = useTokenStore()
  //   config.headers && (config.headers.sessionId = userStore.getSessionId)
  //   config.headers &&
  //     tokenStore.getToken &&
  //     (config.headers.token = tokenStore.getToken)
  const language = cookies.get('language')
  config.headers = config.headers || {}
  if (language) config.headers.language = language

  return config
}, err)

// The response to intercept
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
