import 'dotenv/config'
import express, { Request, Response } from 'express'
import httpProxy from 'http-proxy'

const app = express()
const PORT: number = 8000

const BASE_PATH: string = process.env.BASE_PATH || ''

const proxy = httpProxy.createProxyServer({})

proxy.on('proxyReq', (proxyReq, req, res) => {
    const url = req.url
    if (url === '/')
        proxyReq.path += 'index.html'

})

app.use((req: Request, res: Response) => {
    const hostname = req.hostname
    const subdomain = hostname.split('.')[0]

    if (req.url === '/') {
        req.url = '/index.html'
    }

    const resolvesTo = `${BASE_PATH}/${subdomain}`

    proxy.web(req, res, { target: resolvesTo, changeOrigin: true })
})

app.listen(PORT, () => console.log(`Reverse Proxy Running..${PORT}`))