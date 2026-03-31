const DB_NAME = 'clawlymarket-zk'
const STORE_NAME = 'circuits'
const ZKEY_KEY = 'anthropic-email-light.zkey'

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = () => {
      req.result.createObjectStore(STORE_NAME)
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

async function getCached(): Promise<ArrayBuffer | null> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly')
    const req = tx.objectStore(STORE_NAME).get(ZKEY_KEY)
    req.onsuccess = () => resolve(req.result ?? null)
    req.onerror = () => reject(req.error)
  })
}

async function setCached(data: ArrayBuffer): Promise<void> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    tx.objectStore(STORE_NAME).put(data, ZKEY_KEY)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

// IPFS gateways — try multiple for redundancy
const IPFS_GATEWAYS = [
  'https://dweb.link/ipfs/',
  'https://cloudflare-ipfs.com/ipfs/',
  'https://ipfs.io/ipfs/',
  'https://gateway.pinata.cloud/ipfs/',
  'https://w3s.link/ipfs/',
]

async function fetchFromIPFS(
  cid: string,
  onProgress?: (loaded: number, total: number) => void
): Promise<ArrayBuffer> {
  let lastError: Error | null = null

  for (const gateway of IPFS_GATEWAYS) {
    try {
      const url = `${gateway}${cid}`
      const resp = await fetch(url)
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`)

      const contentLength = Number(resp.headers.get('content-length') || 0)
      if (!resp.body) return await resp.arrayBuffer()

      const reader = resp.body.getReader()
      const chunks: Uint8Array[] = []
      let loaded = 0

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        chunks.push(value)
        loaded += value.byteLength
        onProgress?.(loaded, contentLength)
      }

      const result = new Uint8Array(loaded)
      let offset = 0
      for (const chunk of chunks) {
        result.set(chunk, offset)
        offset += chunk.byteLength
      }
      return result.buffer
    } catch (err) {
      lastError = err as Error
      continue
    }
  }

  throw new Error(`All IPFS gateways failed. Last error: ${lastError?.message}`)
}

// CID is set after pinning — update this after running the upload script
export const ZKEY_CID = import.meta.env.VITE_ZKEY_CID || 'QmSGLghno3yhHZ3Gj1o2e2Guya7BM37TUT5j6LPEtMgvy6'

export async function getZkeyUrl(
  onProgress?: (loaded: number, total: number) => void
): Promise<string> {
  // If VITE_ZKEY_URL is set (local dev), use it directly
  const directUrl = import.meta.env.VITE_ZKEY_URL
  if (directUrl) return directUrl

  // Try IndexedDB cache first
  const cached = await getCached()
  if (cached) {
    return URL.createObjectURL(new Blob([cached]))
  }

  // Fetch from IPFS
  if (!ZKEY_CID) {
    throw new Error(
      'ZK proving key not configured. Set VITE_ZKEY_CID (IPFS) or VITE_ZKEY_URL (direct) in your environment.'
    )
  }

  const data = await fetchFromIPFS(ZKEY_CID, onProgress)

  // Cache in IndexedDB for next time
  await setCached(data)

  return URL.createObjectURL(new Blob([data]))
}
