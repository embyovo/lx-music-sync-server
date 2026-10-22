import { pushSourceToClient } from '@/server/source'

// 客户端连接并完成特性协商后，若客户端支持 source 特性，则向其推送当前音源信息
export const sync = async(socket: LX.Socket) => {
  await pushSourceToClient(socket)
  socket.moduleReadys.source = true
}
