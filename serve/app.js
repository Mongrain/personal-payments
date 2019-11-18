const express = require('express')
const bodyParser = require('body-parser')
const cors = require('cors');
const simpleLogger = require('./middlewares/simpleLogger')
const resAjaxReturn = require('./middlewares/res.ajaxReturn')
const router = require('./controllers/')

const app = express()
const port = 8000

app.use(bodyParser.urlencoded({ extended: false }))//extended为false表示使用querystring来解析数据，这是URL-encoded解析器
app.use(bodyParser.json())//添加json解析器
app.use(cors())
app.use(simpleLogger)
app.use(resAjaxReturn)
app.use(router)

app.listen(port, () => console.log(`Example app listening on port ${port}!`))