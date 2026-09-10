import type { Metadata } from "next";
import { ConfigProvider } from "antd";
import zhCN from "antd/locale/zh_CN";
import "../src/styles/global.css";
import "react-grid-layout/css/styles.css";
import AppLayout from "../src/components/layout/AppLayout";

export const metadata: Metadata = {
  title: "蓝天系统 - 电源域监控",
  description: "蓝天系统 - 电源域监控平台",
  icons: {
    icon: [
      { url: "/icon.png", type: "image/png" },
      { url: "/favicon.ico", type: "image/x-icon" },
    ],
    apple: "/apple-icon.png",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body>
        <ConfigProvider locale={zhCN}>
          <AppLayout>{children}</AppLayout>
        </ConfigProvider>
      </body>
    </html>
  );
}
