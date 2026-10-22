declare namespace LX {

  namespace Sync {
    namespace Source {
      interface SourceUpdateData {
        /**
         * 音源文件下载地址
         * 若启用地址加密（SOURCE_ENCRYPT_URL），该字段为 AES-128-ECB 加密后的 base64 字符串
         * 解密密钥与同步协议连接密钥一致（keyInfo.key，base64 格式）
         */
        url: string

        /**
         * 音源文件内容的 MD5，客户端可用于比对本地缓存的音源版本
         */
        md5: string

        /**
         * 服务端音源文件的更新时间戳（毫秒）
         */
        updateTime: number

        /**
         * url 字段是否经过加密
         */
        encrypted: boolean
      }

      type ActionSourceUpdate = {
        action: 'source_update'
        data: SourceUpdateData
      }

      type ActionSource = ActionSourceUpdate
    }
  }
}
