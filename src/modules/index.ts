import { sync as listSync } from './list'
import { sync as dislikeSync } from './dislike'
import { sync as sourceSync } from './source'

export const callObj = Object.assign({},
  listSync.handler,
  dislikeSync.handler,
)

export const modules = {
  list: listSync,
  dislike: dislikeSync,
  source: sourceSync,
}


export { ListManage, ListEvent, type ListEventType } from './list'

export { DislikeManage, DislikeEvent, type DislikeEventType } from './dislike'

export const featureVersion = {
  list: 1,
  dislike: 1,
  source: 1,
} as const
