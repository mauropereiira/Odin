import { constants } from "node:fs";
import { chmod, lstat, mkdir, open, type FileHandle } from "node:fs/promises";

const NO_FOLLOW = constants.O_NOFOLLOW ?? 0;
const NON_BLOCK = constants.O_NONBLOCK ?? 0;

async function assertRegularFile(handle: FileHandle, path: string): Promise<void> {
  if (!(await handle.stat()).isFile()) throw new Error(`Expected a regular file: ${path}`);
}

export async function ensurePrivateDirectory(path: string): Promise<void> {
  await mkdir(path, { recursive: true, mode: 0o700 });
  const fileStat = await lstat(path);
  if (!fileStat.isDirectory() || fileStat.isSymbolicLink()) {
    throw new Error(`Refusing non-directory private path: ${path}`);
  }
  await chmod(path, 0o700);
}

export async function ensurePrivateTextFile(path: string, contents: string): Promise<void> {
  let handle: FileHandle;
  let created = false;
  try {
    handle = await open(
      path,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | NO_FOLLOW | NON_BLOCK,
      0o600,
    );
    created = true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    handle = await open(path, constants.O_RDONLY | NO_FOLLOW | NON_BLOCK);
  }

  try {
    await assertRegularFile(handle, path);
    if (created) await handle.writeFile(contents, "utf8");
    await handle.chmod(0o600);
  } finally {
    await handle.close();
  }
}

export async function hardenPrivateFile(path: string): Promise<boolean> {
  let handle: FileHandle;
  try {
    handle = await open(path, constants.O_RDONLY | NO_FOLLOW | NON_BLOCK);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
  try {
    await assertRegularFile(handle, path);
    await handle.chmod(0o600);
    return true;
  } finally {
    await handle.close();
  }
}

export async function readPrivateTextFile(
  path: string,
): Promise<{ contents: string; mtimeMs: number } | null> {
  let handle: FileHandle;
  try {
    handle = await open(path, constants.O_RDONLY | NO_FOLLOW | NON_BLOCK);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return null;
    throw error;
  }
  try {
    await assertRegularFile(handle, path);
    const [contents, fileStat] = await Promise.all([handle.readFile("utf8"), handle.stat()]);
    return { contents, mtimeMs: fileStat.mtimeMs };
  } finally {
    await handle.close();
  }
}

export async function writePrivateTextFile(path: string, contents: string): Promise<void> {
  const handle = await open(
    path,
    constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC | NO_FOLLOW | NON_BLOCK,
    0o600,
  );
  try {
    await assertRegularFile(handle, path);
    await handle.writeFile(contents, "utf8");
    await handle.chmod(0o600);
  } finally {
    await handle.close();
  }
}

export async function appendPrivateTextFile(path: string, contents: string): Promise<void> {
  const handle = await open(
    path,
    constants.O_WRONLY | constants.O_CREAT | constants.O_APPEND | NO_FOLLOW | NON_BLOCK,
    0o600,
  );
  try {
    await assertRegularFile(handle, path);
    await handle.writeFile(contents, "utf8");
    await handle.chmod(0o600);
  } finally {
    await handle.close();
  }
}

export async function updatePrivateTextFile(
  path: string,
  update: (current: string) => string,
): Promise<void> {
  const handle = await open(
    path,
    constants.O_RDWR | constants.O_CREAT | NO_FOLLOW | NON_BLOCK,
    0o600,
  );
  try {
    await assertRegularFile(handle, path);
    const current = await handle.readFile("utf8");
    const next = update(current);
    if (next !== current) {
      await handle.truncate(0);
      const contents = Buffer.from(next, "utf8");
      let offset = 0;
      while (offset < contents.length) {
        const { bytesWritten } = await handle.write(
          contents,
          offset,
          contents.length - offset,
          offset,
        );
        if (bytesWritten === 0) throw new Error(`Unable to write private file: ${path}`);
        offset += bytesWritten;
      }
    }
    await handle.chmod(0o600);
  } finally {
    await handle.close();
  }
}
