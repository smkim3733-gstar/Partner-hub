import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  metadataBase: new URL('https://keve-partner-hub.smkim3733.chatgpt.site'),
  title: '한기평 파트너 허브',
  description: '기업컨설팅 협업신청부터 상담, 서류, 견적, 계약, 사후관리까지 한 번에 관리하는 협업 포털',
  openGraph: {
    title: '한기평 파트너 허브',
    description: '기업 협업의 모든 진행을 한눈에',
    url: 'https://keve-partner-hub.smkim3733.chatgpt.site',
    siteName: '한기평 파트너 허브',
    locale: 'ko_KR',
    type: 'website',
    images: [
      {
        url: 'https://keve-partner-hub.smkim3733.chatgpt.site/og.png',
        width: 1200,
        height: 630,
        alt: '한기평 파트너 허브 - 기업 협업의 모든 진행을 한눈에',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: '한기평 파트너 허브',
    description: '기업 협업의 모든 진행을 한눈에',
    images: ['https://keve-partner-hub.smkim3733.chatgpt.site/og.png'],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
