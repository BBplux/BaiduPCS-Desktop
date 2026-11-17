using System;using System.Runtime.InteropServices;
public static class ReferenceInput {
 [StructLayout(LayoutKind.Sequential)] public struct RECT {public int Left,Top,Right,Bottom;}
 [StructLayout(LayoutKind.Sequential)] struct MOUSEINPUT {public int dx,dy;public uint mouseData,dwFlags,time;public UIntPtr extra;}
 [StructLayout(LayoutKind.Explicit)] struct UNION {[FieldOffset(0)]public MOUSEINPUT mouse;}
 [StructLayout(LayoutKind.Sequential)] struct INPUT {public uint type;public UNION data;}
 [StructLayout(LayoutKind.Sequential)] struct POINT {public int X,Y;public POINT(int x,int y){X=x;Y=y;}}
 [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hwnd,out RECT r);
 [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
 [DllImport("user32.dll")] static extern bool SetCursorPos(int x,int y);
 [DllImport("user32.dll")] static extern IntPtr WindowFromPoint(POINT p);
 [DllImport("user32.dll")] static extern IntPtr GetAncestor(IntPtr hwnd,uint flags);
 [DllImport("user32.dll",SetLastError=true)] static extern uint SendInput(uint count,INPUT[] inputs,int size);
 public static void Click(IntPtr hwnd,int left,int top,int width,int height,int x,int y){ClickButton(hwnd,left,top,width,height,x,y,false);}
 public static void RightClick(IntPtr hwnd,int left,int top,int width,int height,int x,int y){ClickButton(hwnd,left,top,width,height,x,y,true);}
 static void ClickButton(IntPtr hwnd,int left,int top,int width,int height,int x,int y,bool right){
 RECT r;if(!GetWindowRect(hwnd,out r)||r.Left!=left||r.Top!=top||r.Right-r.Left!=width||r.Bottom-r.Top!=height)throw new Exception("Window geometry changed; recapture required");
 if(GetForegroundWindow()!=hwnd)throw new Exception("Target is not foreground");
 if(GetAncestor(WindowFromPoint(new POINT(x,y)),2)!=hwnd)throw new Exception("Another window covers target");
 SetCursorPos(x,y);var inputs=new INPUT[2];inputs[0].data.mouse.dwFlags=right?8u:2u;inputs[1].data.mouse.dwFlags=right?16u:4u;
 if(SendInput(2,inputs,Marshal.SizeOf(typeof(INPUT)))!=2)throw new Exception("SendInput failed: "+Marshal.GetLastWin32Error());
 }
}
