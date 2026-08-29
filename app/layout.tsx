import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: '한기평 파트너 허브',
  description: '기업컨설팅 협업신청부터 상담, 서류, 견적, 계약, 사후관리까지 한 번에 관리하는 협업 포털',
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
