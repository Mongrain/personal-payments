module.exports = (req, res, next) => {
  // express中间件入参为 req, res, next
  // 而koa中间件则入参为 ctx, next
  res.ajaxReturn = content => {
    if(typeof content === 'object' && content.hasOwnProperty('success')) {
      res.send(content)
      return;
    }
    res.send (
      Object.assign(
        {},
        {
          success: true,
          errorCode:null,
          errorMsg: null,
          data: content
        },
      )
    )
  }
  next()
}
