import type { DriveFileItem } from '../types/editor';

const DRIVE_API_BASE = 'https://www.googleapis.com/drive/v3';
const DRIVE_UPLOAD_BASE = 'https://www.googleapis.com/upload/drive/v3';

export async function listDriveMediaFiles(
  accessToken: string,
  searchTerm = ''
): Promise<DriveFileItem[]> {
  const cleanSearch = searchTerm.trim().replace(/'/g, "\\'");
  const baseFilter =
    "(mimeType contains 'video/' or (mimeType = 'application/json' and name contains 'framecut')) and trashed = false";
  const q = cleanSearch ? `${baseFilter} and name contains '${cleanSearch}'` : baseFilter;

  const params = new URLSearchParams({
    q,
    pageSize: '25',
    orderBy: 'modifiedTime desc',
    fields: 'files(id,name,mimeType,size,modifiedTime,thumbnailLink)',
  });

  const res = await fetch(`${DRIVE_API_BASE}/files?${params.toString()}`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!res.ok) {
    const errBody = await res.text().catch(() => '');
    throw new Error(`Google Drive request failed (${res.status}): ${errBody || res.statusText}`);
  }

  const data = (await res.json()) as { files?: DriveFileItem[] };
  return data.files ?? [];
}

export async function fetchDriveVideoBlobUrl(
  accessToken: string,
  fileId: string
): Promise<string> {
  const res = await fetch(`${DRIVE_API_BASE}/files/${encodeURIComponent(fileId)}?alt=media`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!res.ok) {
    throw new Error(`Could not download video from Google Drive (${res.status}).`);
  }

  const blob = await res.blob();
  return URL.createObjectURL(blob);
}

export async function uploadProjectEdlToDrive(
  accessToken: string,
  projectTitle: string,
  edlData: Record<string, unknown>
): Promise<DriveFileItem> {
  const safeName = projectTitle
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-_]+/g, '_')
    .slice(0, 64);
  const fileName = `${safeName || 'sequence'}.framecut.json`;

  const metadata = {
    name: fileName,
    mimeType: 'application/json',
  };

  const boundary = 'framecut_multipart_boundary_' + Date.now();
  const body = [
    `--${boundary}`,
    'Content-Type: application/json; charset=UTF-8',
    '',
    JSON.stringify(metadata),
    `--${boundary}`,
    'Content-Type: application/json',
    '',
    JSON.stringify(edlData, null, 2),
    `--${boundary}--`,
  ].join('\r\n');

  const res = await fetch(`${DRIVE_UPLOAD_BASE}/files?uploadType=multipart&fields=id,name,mimeType,size,modifiedTime`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': `multipart/related; boundary=${boundary}`,
    },
    body,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Failed to upload project to Google Drive (${res.status}): ${text}`);
  }

  return (await res.json()) as DriveFileItem;
}

export async function deleteDriveFile(
  accessToken: string,
  fileId: string
): Promise<void> {
  const res = await fetch(`${DRIVE_API_BASE}/files/${encodeURIComponent(fileId)}`, {
    method: 'DELETE',
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Failed to delete Google Drive file (${res.status}): ${text}`);
  }
}

export async function uploadBlobToDrive(
  accessToken: string,
  fileName: string,
  blob: Blob
): Promise<DriveFileItem> {
  const metadata = {
    name: fileName,
    mimeType: blob.type || 'video/mp4',
  };

  const form = new FormData();
  form.append(
    'metadata',
    new Blob([JSON.stringify(metadata)], { type: 'application/json' })
  );
  form.append('file', blob, fileName);

  const res = await fetch(
    `${DRIVE_UPLOAD_BASE}/files?uploadType=multipart&fields=id,name,mimeType,size,modifiedTime`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
      body: form,
    }
  );

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Failed to upload video to Google Drive (${res.status}): ${text}`);
  }

  return (await res.json()) as DriveFileItem;
}
