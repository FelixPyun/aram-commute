import './styles.css';

export const metadata = {
  title: '아람출퇴근',
  description: '인천 버스 실시간 도착정보 전용 페이지',
  manifest: '/manifest.webmanifest',
  applicationName: '아람출퇴근',
  appleWebApp: {
    capable: true,
    title: '아람출퇴근',
    statusBarStyle: 'default',
  },
  icons: {
    icon: [
      { url: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { url: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
    apple: [{ url: '/icons/apple-touch-icon.png', sizes: '180x180', type: 'image/png' }],
  },
};

export const viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#f7f9fd',
};

export default function RootLayout({ children }) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
