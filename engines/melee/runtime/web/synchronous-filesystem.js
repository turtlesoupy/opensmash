// Asyncify is used only for explicit GPU event-loop yields. Preserve the
// non-Asyncify fsync behavior: IDBFS autoPersist handles durable writes, while
// native file calls remain synchronous and cannot overlap Asyncify unwinds.
addToLibrary({
  fd_sync__deps: ['$FS', '$SYSCALLS'],
  fd_sync__proxy: 'sync',
  fd_sync__async: false,
  fd_sync: function(fd) {
    try {
      var stream = SYSCALLS.getStreamFromFD(fd);
      if (stream.stream_ops.fsync) return stream.stream_ops.fsync(stream);
      return 0;
    } catch (error) {
      if (!(error instanceof FS.ErrnoError)) throw error;
      return error.errno;
    }
  },
});
