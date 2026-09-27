import { DownloadPage } from '../../../../components/sellbase/download-page';

export default async function Download({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <DownloadPage token={token} contactHref="mailto:hola@tienda-demo.test" />;
}
