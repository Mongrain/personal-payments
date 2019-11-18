const moment = require('moment')
const { promisify } = require('util');
const { Sequelize, Model, DataTypes } = require('sequelize');
const { db } = require('../config.json')

// initial sequelize
const sequelize = new Sequelize(`mysql://${db.username}:${db.password}@${db.domain}:${db.port}/${db.tableName}`, {
  'dialectOptions': {
    charset: "utf8",
  },
});
// redis
const client = require("redis").createClient();
const getAsync = promisify(client.get).bind(client);
// 同样价格允许同时20张单存在
const PAY_BILLS = 20

class Order extends Model { }
Order.init({
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true }, // 订单id
  user: DataTypes.STRING, // 持单用户
  page: DataTypes.STRING, // 购买页面
  isPayed: DataTypes.INTEGER, // 支付状态
  price: DataTypes.DECIMAL(10, 2), // 真实支付价格
}, { sequelize, modelName: 'order' });

/**
 * fetch data in the redis
 */
async function getStorageData() {
  let userCurrentNumber = await getAsync('userCurrentNumber');
  let priceCharge = await getAsync('priceCharge');
  userCurrentNumber = JSON.parse(userCurrentNumber) || {};
  priceCharge = JSON.parse(priceCharge) || {};

  return [userCurrentNumber, priceCharge]
}
/**
 * set data in the redis
 */
async function setStorageData(userCurrentNumber, priceCharge) {
  // redis 存储
  client.set("userCurrentNumber", JSON.stringify(userCurrentNumber));
  client.set("priceCharge", JSON.stringify(priceCharge));
}
/**
 * init redis data
 */
async function initStorageData(userCurrentNumber, priceCharge) {
  // redis 存储
  client.set("userCurrentNumber", "{}");
  client.set("priceCharge", "{}");
}

/**
 * 通过真实价格返回对应的市场价
 * @param {Number} realPrice 
 */
async function getMarkPrice(realPrice) {
  const [userCurrentNumber] = await getStorageData()
  let ret = -1
  Object.entries(userCurrentNumber).some(([markPrice, users]) => {
    if (Object.values(users).some((item) => item.some(({ price }) => Number(price) === Number(realPrice)))) {
      ret = markPrice
    }
  })
  return ret
}

/**
 * bill
 * work in redis
 */
const myBill = {
  async create({ price, user, key, trackingId }) {
    price = Number(price)
    const [userCurrentNumber, priceCharge] = await getStorageData();
    // initialize
    initStorageDataByPriceAndUser();
    // check record
    const record = checkHasRecord();
    if (record) return record;
    // create new record
    const newRecord = {
      id: trackingId,
      key,
      price: getNewPriceAndRemoveRealPriceInPriceCharge(),
      expired: Date.now() + 5 * 36000
    }
    // append record to records
    userCurrentNumber[price][user].push(newRecord);
    // set data
    setStorageData(userCurrentNumber, priceCharge);
    // return new record
    return newRecord;

    function initStorageDataByPriceAndUser() {
      // 初始化用户价格
      if (!userCurrentNumber[price]) userCurrentNumber[price] = {};
      // 初始化管理价格
      if (!priceCharge[price]) priceCharge[price] = Array.from({ length: PAY_BILLS }).map((_, i) => (price - i / 100).toFixed(2));
      // 初始化这个价格的用户的数据
      if (!Array.isArray(userCurrentNumber[price][user])) userCurrentNumber[price][user] = []
    }

    function checkHasRecord() {
      let currentMemberPriceByUser = userCurrentNumber[price][user];
      // 如果当前用户有历史数据，return
      if (currentMemberPriceByUser && (currentMemberPriceByUser.expired - Date.now()) && key == currentMemberPriceByUser.key) return currentMemberPriceByUser;
      return null
    }

    function getNewPriceAndRemoveRealPriceInPriceCharge() {
      // 当前价格的价格管理
      let currentChargeByPrice = priceCharge[price];
      // 如果没有号码就返回空
      if (currentChargeByPrice.length <= 0) return null
      // 随机立减
      const currentIndex = (Math.random() * currentChargeByPrice.length % currentChargeByPrice.length) | 0;
      // 返回价格
      const ret = currentChargeByPrice[currentIndex];
      // 移除价格控制里的当前价格
      priceCharge[price].splice(currentIndex, 1);
      return ret;
    }
  },
  async fetch({ price, realPrice, user, key }) {
    const [userCurrentNumber, priceCharge] = await getStorageData();
    console.log('========== fetch ============')
    console.log('userCurrentNumber', userCurrentNumber)
    console.log('priceCharge', priceCharge)
    console.log('========== /fetch ============')
    // 付款的金额
    price = Number(price)
    realPrice = Number(realPrice)
    if (user && price && key) {
      try {
        const userSchedules = userCurrentNumber[price] ? userCurrentNumber[price][user] || [] : []
        let ret = null
        userSchedules.some((item) => {
          if (item.expired - Date.now() && item.key == key) {
            ret = item
            return true
          }
          return false
        })
        return ret
      } catch (err) {
        return null
      }
    } else if (realPrice) {
      async function getUserByPrice(realPrice) {
        let target = null;
        // const price = Math.ceil(realPrice)
        const price = await getMarkPrice(realPrice)
        console.log('getMarkPrice', price)
        console.log(userCurrentNumber[String(price)])
        if (userCurrentNumber[price]) {
          Object.entries(userCurrentNumber[price]).some(([k, v]) => v.some((item) => {
            if (Number(item.price) === Number(realPrice) && item.expired - Date.now()) {
              target = item
              return true
            }
            return false
          }))
        }
        return target;
      }
      const ret = await getUserByPrice(realPrice)
      if (ret && ret.expired - Date.now()) {
        return await getUserByPrice(realPrice)
      }
      return null
    } else {
      return null
    }
  }
}

stepUp()

/**
 * start
 */
function stepUp() {
  initStorageData();
  setInterval(async () => {
    const [userCurrentNumber, priceCharge] = await getStorageData();
    const pricesArr = Object.entries(userCurrentNumber)
    pricesArr.map(([k, value]) => {
      Object.entries(value).map(([user, userSchedules]) => {
        userCurrentNumber[k][user] = userSchedules.filter(({ price, expired }) => {
          // 过期了
          if (expired - Date.now() < 0) {
            const markPrice = await getMarkPrice(price)
            priceCharge[markPrice].push(price)
            return false
          }
          return true
        })
      })
    })
    setStorageData(userCurrentNumber, priceCharge);
  }, 1000)
}

ROUTER.post('/bill/payed', async (req, res, next) => {
  console.log('payed is got a request.', req.body)
  // 付款的金额
  let { realPrice } = req.body
  const bill = await myBill.fetch({ realPrice: realPrice })
  if (!bill) return res.send('error')
  try {
    await Order.update({ isPayed: 1 }, { raw: true, where: { id: bill.id } })
    res.send('success')
  } catch (err) {
    res.send('error')
  }
})

ROUTER.post('/order/create', async (req, res, next) => {
  // 付款的金额
  let { price, user, page } = req.body
  price = Number(price)
  await sequelize.sync()
  const bill = await myBill.fetch({ price, user, key: page })
  if (bill) return res.send(bill)
  const order = await ensureAnOrder();
  // check is payed
  if (order.isPayed) return res.send({ message: '页面已经购买', ret: 0 });
  // create a new bill
  const newBill = await myBill.create({
    trackingId: order.id,
    price,
    user,
    key: page
  })
  res.send(newBill);

  async function ensureAnOrder() {
    let order = await Order.findOne({ raw: true, where: { page, user } })
    if (!order) {
      order = await Order.create({
        user,
        page,
        isPayed: 0, // 支付状态
        realPrice: 0, // 真实支付价格
        price: price, // 市场价
      })
    }
    return order
  }
})

ROUTER.get('/order/list', (req, res, next) => {
  // 付款的金额
  let { user, page } = req.query
  sequelize.sync()
    .then(() => Order.findOne({ raw: true, where: { page, user } }))
    .then(sres => {
      if (sres) {
        res.send({ show: sres.isPayed })
      } else {
        res.send({ show: 0 })
      }
    })
})
