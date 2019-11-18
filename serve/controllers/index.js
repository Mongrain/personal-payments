const express = require('express')
const router = express.Router()

module.exports = router

// 使用全局变量方便开发
Object.assign(global, {
  ROUTER: router
})

// 自动遍历引入本目录下所有控制器
require('require-directory')(module)
