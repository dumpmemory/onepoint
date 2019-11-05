'use strict';
const cookie = require('cookie');
const querystring = require('querystring');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const { Msg_info, urlSpCharEncode } = require('./function').tool_funcs;

const drive_funcs = {};
drive_funcs['ms_od_sharepoint'] = require("./lib/ms_od_sharepoint");
drive_funcs['goo_gd_goindex'] = require("./lib/goo_gd_goindex");
drive_funcs['oth_linux_scf'] = require("./lib/oth_linux_scf");

const render_funcs = {};
render_funcs['render'] = require("./views/render").render;

let G_CONFIG, DRIVE_MAP, DOMAIN_MAP, RENDER;
const DRIVE_MAP_KEY = [];
const DRIVES_IN_DIR = {};
/**
 * onepoint ukuq
 * time:191105
 */

initialize();
/**
 * 初始化 drivemap,完成虚拟云盘的排序 和虚拟云盘在目录列表下的添加
 */
function initialize() {
    let config_json = JSON.parse(fs.readFileSync(path.resolve(__dirname, './config.json'), 'utf8'));
    G_CONFIG = config_json['G_CONFIG'];
    DRIVE_MAP = config_json['DRIVE_MAP'];
    DOMAIN_MAP = config_json['DOMAIN_MAP'];
    RENDER = render_funcs[G_CONFIG.render_name];
    console.log(DRIVE_MAP);
    refreshCache();
    //初始化key的集合, 倒序排列方便匹配
    for (let k in DRIVE_MAP) {
        DRIVE_MAP_KEY.push(k);
    }
    DRIVE_MAP_KEY.sort((a, b) => { return b.localeCompare(a) });//逆序
    DRIVE_MAP_KEY.forEach(
        k => {
            let last = k.lastIndexOf('/');
            while (last > 0) {// eg:k = /mmx/a/b/
                last = k.lastIndexOf('/', last - 1);
                let driveNode = {
                    nodeType: 3,//type: 3_drive 
                    name: k.slice(last + 1, -1),//文件名
                    fileType: "",//文件类型，不带点
                    url_p2: k.slice(last),//以p2为基准的根目录
                    size: "drive",//文件大小xx.xx MB, 保留两位小数，中间空格不可少
                    modified: "",//最近修改日期，固定格式
                    otherInfo: {}//此项不用，留给开发者存放其他信息 可为 undefined
                };
                k = k.slice(0, last + 1); ///m = /mmx/a/
                if (!DRIVES_IN_DIR[k]) {//首个一定不重复
                    DRIVES_IN_DIR[k] = [];
                    DRIVES_IN_DIR[k].push(driveNode);
                } else {//可能重复,需要遍历决定添加与否
                    let isHave = 0;
                    DRIVES_IN_DIR[k].forEach(e => { if (e.name === driveNode.name) isHave = 1 });
                    if (!isHave) DRIVES_IN_DIR[k].push(driveNode);
                }
            }
        }
    );
}

/**
 * 清除所有cache, 为密码增加hash值,默认一天更新一次
 */
function refreshCache() {
    //设置过了 UTCDate ,并且时间和今天一致, 无需更新
    if (new Date().getUTCDate === G_CONFIG.UTCDate) return;
    //设置管理员密码 hash 值
    let time = new Date();
    G_CONFIG.UTCDate = time.getUTCDate();
    const hash = crypto.createHash('md5');
    hash.update(G_CONFIG.admin_password + time.getUTCMonth() + time.getUTCDate());
    G_CONFIG.admin_password_date_hash = hash.digest('hex');
    //初始化 drive 的 cache,密码hash值
    //清除 cache
    for (let k in DRIVE_MAP) {
        DRIVE_MAP[k].cache = {};
        if (DRIVE_MAP[k].password) {
            const hash = crypto.createHash('md5');
            hash.update(DRIVE_MAP[k].password + time.getUTCMonth() + time.getUTCDate());
            DRIVE_MAP[k].password_date_hash = hash.digest('hex');
        } else {
            DRIVE_MAP[k].password = '';
            DRIVE_MAP[k].password_date_hash = 'no_password';
        }
    }
}

/**
 * 返回, 一些清理工作可放这里
 * @param {*} statusCode 
 * @param {*} headers 
 * @param {*} body 
 * @param {*} isBase64Encoded 
 */
function endMsg(statusCode, headers, body, isBase64Encoded) {
    console.log('end_time:' + new Date().toLocaleString(), 'utf-8');
    return {
        'isBase64Encoded': isBase64Encoded || false,
        'statusCode': statusCode,
        'headers': headers,
        'body': body
    }
}

exports.main_handler = async (event, context, callback) => {
    const start_time = new Date();
    console.log('start_time:' + start_time.toLocaleString(), 'utf-8');

    event['path'] = decodeURIComponent(event['path']);//处理中文字符
    let req_body_json = {}, req_cookie_json = {};
    if (event['headers']['content-type'] === 'application/x-www-form-urlencoded') {
        req_body_json = querystring.parse(event['body'])
    } else if (event['headers']['content-type'] === 'application/json') {
        req_body_json = JSON.parse(event['body']);// 此处不捕捉 parse error
    }
    if (event['headers']['cookie']) req_cookie_json = cookie.parse(event['headers']['cookie']);// 此处不捕捉 parse error
    console.log(event);


    let host = event['headers']['host'];
    let p_12, p0, p1, p2, driveMap;
    let res_html = "something wrong!", res_headers = { 'Content-Type': 'text/html' }, res_statusCode = 200;
    let responseMsg;

    //处理域名和路径,分离得到 p0 p12
    let requestContext_path = event['requestContext']['path'];
    if (requestContext_path.endsWith('/')) requestContext_path = requestContext_path.slice(0, -1);// / or /abc/
    if (event['headers']['host'].startsWith(event['requestContext']['serviceId'])) {//长域名
        p0 = `/${event['requestContext']['stage']}${requestContext_path}`;
        p_12 = event['path'].slice(requestContext_path.length) || '/';//  只有scf网关不规范 ,例如 /abc 前者才为假
    } else {
        p0 = DOMAIN_MAP[host] || "";
        p_12 = event['path'].slice(p0.length) || '/';
    }

    console.info('p_12:' + p_12);

    refreshCache();
    if (p_12.startsWith('/admin/')) {
        let li = '<html><body><ul>';
        li += `<li>${G_CONFIG.admin_password}</li>`;
        li += `<li>${G_CONFIG.admin_password_date_hash}</li>`;
        for (let i = DRIVE_MAP_KEY.length - 1; i >= 0; i--) {
            let dm = DRIVE_MAP_KEY[i];
            li += `<li>${dm}</li>`;
            li += `<li>${DRIVE_MAP[dm].password}</li>`;
            li += `<li>${DRIVE_MAP[dm].password_date_hash}</li>`;
        }
        li += '</ul></body></html>';
        return endMsg(200, res_headers, li);
    }

    //域名映射
    for (let i = 0; i < DRIVE_MAP_KEY.length; i++) {
        let dm = DRIVE_MAP_KEY[i];
        if (p_12.startsWith(dm)) {
            console.log("映射路径为:" + dm);
            driveMap = DRIVE_MAP[dm];
            p1 = dm.slice(0, -1);
            p2 = p_12.slice(dm.length - 1);

            if (driveMap.password) {//有密码
                if (event['httpMethod'] === 'POST' && req_body_json['password']) {//使用密码 或者 cookie 登录
                    if (req_body_json['password'] === driveMap.password || req_body_json['password'] === driveMap.password_date_hash) {//单个云盘登录
                        res_headers['set-cookie'] = cookie.serialize('password', driveMap.password_date_hash, { path: p0 + p1, maxAge: 3600 });
                    } else if (req_body_json['password'] === G_CONFIG.admin_password) {//管理员登录 ,只允许密码
                        res_headers['set-cookie'] = cookie.serialize('password', G_CONFIG.admin_password_date_hash, { path: p0, maxAge: 3600 });
                    } else {//密码错误
                        responseMsg = Msg_info(401, '密码错误');
                    }
                    console.log('使用密码登录:' + req_body_json['password']);
                } else if (req_cookie_json['password']) {//使用cookie
                    if (req_cookie_json['password'] !== G_CONFIG.admin_password_date_hash && req_cookie_json['password'] !== driveMap.password_date_hash) {
                        responseMsg = Msg_info(401, 'cookie失效,请重新登录');
                    }
                    console.log('使用cookie登录:' + req_cookie_json['password']);
                } else responseMsg = Msg_info(401, '请输入密码');
            }
            break;
        }
    }
    if (!p2) throw 'no such cast found';
    let splitPath = { ph: "//" + host, p0: urlSpCharEncode(p0), p1: urlSpCharEncode(p1), p2: urlSpCharEncode(p2) };
    let request = {
        httpMethod: event['httpMethod'],
        url_ph01: "//" + host + p0 + p1,// //ph/p0/p1, 例如 //release/mmx
        url_p2: p2,// p2, 路径信息，查询该路径下的文件列表或文件。例如 /a/b/c
        queryString: event['queryString'], //scf event 提供
        headers: event['headers'],//scf event 提供
        body: event['body'],//scf event 提供
        sourceIp: event['requestContext']['sourceIp']//访问源ip
    }
    if (!responseMsg) responseMsg = await drive_funcs[driveMap.funcName].func(driveMap.spConfig, driveMap.cache, request);
    res_statusCode = responseMsg.statusCode;
    switch (res_statusCode) {//200  301 302 401 403 404 500,
        case 200:
            if (responseMsg.type === 1) {//文件夹 
                let p_12 = p1 + p2;
                if (DRIVES_IN_DIR[p_12] && DRIVES_IN_DIR[p_12].length > 0) {//映射盘目录下发现网盘
                    if (responseMsg.data.content.length === 0 || responseMsg.data.content[0].nodeType !== 3) {//为空或者首位不是网盘节点,则添加该节点
                        DRIVES_IN_DIR[p_12].forEach(e => {
                            responseMsg.data.content.unshift(e);
                        });
                    }
                }
                res_html = RENDER.r200_list(responseMsg.data, responseMsg.readMe, responseMsg.script, splitPath, G_CONFIG);
            } else if (responseMsg.type === 0) {//文件
                if (event['queryString']['preview'])
                    res_html = RENDER.r200_file(responseMsg.data.fileInfo, responseMsg.readMe, responseMsg.script, splitPath, G_CONFIG);//预览模式
                else {
                    res_statusCode = 301;
                    res_headers['location'] = responseMsg.data.fileInfo.downloadUrl;
                    res_html = "redirecting to :" + res_headers['location'];
                }
            } else if (responseMsg.type === 3) {
                res_html = RENDER.rxxx_info(responseMsg.info, responseMsg.readMe, responseMsg.script, splitPath, G_CONFIG);
            }
            break;
        case 301:
        case 302:
            res_headers['location'] = responseMsg.headers.location;
            res_html = responseMsg.info || "redirecting to :" + res_headers['location'];
            break;
        case 401:
            res_html = RENDER.r401_auth(responseMsg.info, responseMsg.readMe, responseMsg.script, splitPath, G_CONFIG);
            break;
        case 403:
        case 404:
        case 500:
            res_html = RENDER.rxxx_info(responseMsg.info, responseMsg.readMe, responseMsg.script, splitPath, G_CONFIG);
            break;
        default:
            break;
    }
    if (Object.prototype.toString.call(responseMsg.headers) === '[object Object]') {
        for (let h in responseMsg.headers) res_headers[h] = responseMsg.headers[h];
    }
    return endMsg(res_statusCode, res_headers, res_html);
};

//exports.main_handler({ path: '/onepoint', queryString: {} });//spPage: undefined, isJson: true 
exports.main_handler({ path: '/', headers: { host: "idid000.com" }, requestContext: { path: "/", serviceId: "idid", stage: 'release' }, queryString: {} });//nextPage: undefined, isJson: true 
