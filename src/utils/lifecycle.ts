// 进程是否正在退出；/ready 和中间件靠它判断要不要继续接流量
export const lifecycle = {
  shuttingDown: false,
};
