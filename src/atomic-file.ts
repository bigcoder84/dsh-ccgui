/**
 * A small file the plugin rewrites whole. Writes run one at a time in call order, so a later,
 * fuller snapshot never lands under an earlier one; each goes through a temporary file, so a
 * reader never sees half a file.
 * @module dsh-ccgui/atomic-file
 */

import { randomUUID } from 'node:crypto'
import { mkdir, rename, rm, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

/** One file, with writes kept in order. */
export class AtomicFile {
  private writing: Promise<void> = Promise.resolve()

  constructor(private readonly path: string) {}

  /**
   * Replace the file's contents.
   * @param text - the whole new contents.
   * @returns settles once this text is on disk; rejects when it could not be written.
   */
  write(text: string): Promise<void> {
    const written = this.writing.then(() => this.replace(text))
    this.writing = written.catch(() => {
      /* the caller of this write is told; the next one still runs */
    })
    return written
  }

  private async replace(text: string): Promise<void> {
    const temporary = `${this.path}.${randomUUID()}.tmp`
    await mkdir(dirname(this.path), { recursive: true })
    try {
      await writeFile(temporary, text, 'utf8')
      await rename(temporary, this.path)
    } catch (error: unknown) {
      await rm(temporary, { force: true })
      throw error
    }
  }
}
