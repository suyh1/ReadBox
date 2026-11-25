export interface Mark {
  kind: 'bookmark' | 'highlight'
  cfi: string
  chapter: string
  quote: string
  note: string
}

export interface ShelfBook {
  id: string
  title: string
  author: string
  cover?: Blob
  added: number
  lastRead: number
  favorite: boolean
  cfi: string
  progress: number
  chapter: string
  marks: Mark[]
}

let database: Promise<IDBDatabase> | undefined
async function db() {
  if (!database) {
    database = new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('readbox-library', 1)
      request.onupgradeneeded = () => {
        request.result.createObjectStore('books', { keyPath: 'id' })
        request.result.createObjectStore('files')
      }
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    }).catch((error) => {
      database = undefined
      throw error
    })
  }
  return database
}

function result<T>(request: IDBRequest<T>) {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

function committed(tx: IDBTransaction) {
  return new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onabort = () => reject(tx.error || new Error('保存失败'))
  })
}

export async function hasBook(id: string) {
  return !!(await result((await db()).transaction('books').objectStore('books').getKey(id)))
}

export async function listBooks(): Promise<ShelfBook[]> {
  return result((await db()).transaction('books').objectStore('books').getAll())
}

export async function readFile(id: string): Promise<Blob> {
  const file = await result((await db()).transaction('files').objectStore('files').get(id))
  if (!file) throw new Error('找不到书籍文件，请重新导入。')
  return file
}

export async function addBook(book: ShelfBook, file: Blob) {
  const tx = (await db()).transaction(['books', 'files'], 'readwrite')
  const done = committed(tx)
  const books = tx.objectStore('books')
  const exists = books.getKey(book.id)
  exists.onsuccess = () => {
    if (exists.result) return
    books.add(book)
    tx.objectStore('files').add(file, book.id)
  }
  await done
  return !exists.result
}

// Read and update in the same transaction so progress and notes cannot overwrite one another.
export async function updateBook(id: string, change: (record: ShelfBook) => void) {
  const tx = (await db()).transaction('books', 'readwrite')
  const done = committed(tx)
  const books = tx.objectStore('books')
  const request = books.get(id)
  request.onsuccess = () => {
    if (request.result) {
      change(request.result)
      books.put(request.result)
    }
  }
  await done
}

export async function removeBook(id: string) {
  const tx = (await db()).transaction(['books', 'files'], 'readwrite')
  const done = committed(tx)
  tx.objectStore('books').delete(id)
  tx.objectStore('files').delete(id)
  await done
}
