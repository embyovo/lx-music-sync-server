declare namespace LX {
  type OnlineSource = 'kw' | 'kg' | 'tx' | 'wy' | 'mg'
  type Source = OnlineSource | 'local'
  type Quality = '128k' | '320k' | 'flac' | 'flac24bit' | '192k' | 'ape' | 'wav'
  type QualityList = Partial<Record<Source, Quality[]>>
  type AddMusicLocationType = 'top' | 'bottom'

  namespace Sync {
    interface Status {
      status: boolean
      message: string
      address: string[]
      // code: string
      devices: KeyInfo[]
    }
    interface KeyInfo {
      clientId: string
      key: string
      deviceName: string
      lastConnectDate?: number
      isMobile: boolean
    }

    interface ListConfig {
      skipSnapshot: boolean
    }
    interface DislikeConfig {
      skipSnapshot: boolean
    }
    interface SourceConfig {}
    type ServerType = 'desktop-app' | 'server'
    interface EnabledFeatures {
      list?: false | ListConfig
      dislike?: false | DislikeConfig
      source?: false | SourceConfig
    }
    type SupportedFeatures = Partial<{ [k in keyof EnabledFeatures]: number }>
  }

  interface SourceServiceConfig {
    /**
     * 音源文件地址
     */
    url: string

    /**
     * 音源自动更新检查间隔（分钟）
     */
    updateInterval: number

    /**
     * 推送给客户端时是否加密音源地址
     */
    encryptUrl: boolean

    /**
     * 音源下载接口是否允许公开访问（跳过 token 校验）
     */
    publicAccess: boolean
  }
}
