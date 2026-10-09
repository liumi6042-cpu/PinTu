// Compatibility for already-open pages: stop delivery/writes and back off polls.
function retired(){return Response.json({messages:[],canModerate:false,error:'大厅聊天已下线 / Lobby chat has been removed'},{status:410,headers:{'Cache-Control':'no-store','Retry-After':'86400'}});}
export const GET=retired;
export const POST=retired;
