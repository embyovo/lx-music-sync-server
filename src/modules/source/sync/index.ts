import { setSourceSocketServer } from '@/server/source'
import { sync } from './sync'

export { sync }

export const registerEvent = (wss: LX.SocketServer) => {
  setSourceSocketServer(wss)
}

export const unregisterEvent = () => {
  setSourceSocketServer(null)
}
