export type Persistence = 'static' | 'variable';
export type Sharing = 'shareable' | 'unshareable';

export interface FhsNode {
  path: string;
  summary: string;
  detail: string;
  persistence: Persistence;
  sharing: Sharing;
  /** set when FHS 3.0 classifies this directory explicitly */
  specNote?: string;
  examples: string[];
  children?: FhsNode[];
}

/**
 * Directory summaries are the FHS 3.0 requirement-table wordings
 * (§3.2 root, §4.2 /usr, §5.2 /var). specNote marks directories the
 * standard classifies explicitly in its §2 example matrix or §5.1 text.
 */
export const FHS: FhsNode = {
  path: '/',
  summary: 'The root filesystem',
  detail:
    'Everything hangs off a single tree — there are no drive letters. The root filesystem must contain all the tools and configuration needed to boot, restore, recover, and repair the system, so it is kept small and local to the host.',
  persistence: 'static',
  sharing: 'unshareable',
  examples: [],
  children: [
    {
      path: '/bin',
      summary: 'Essential command binaries',
      detail:
        'Commands available to all users that are needed in single-user mode and for booting or repairing the system. On distributions with a merged /usr, /bin is a symlink to /usr/bin.',
      persistence: 'static',
      sharing: 'unshareable',
      examples: ['ls', 'cp', 'mv', 'cat', 'bash'],
    },
    {
      path: '/boot',
      summary: 'Static files of the boot loader',
      detail:
        'Kernel images, initramfs, and boot loader configuration — everything needed before the root filesystem is mounted. Often a separate small partition.',
      persistence: 'static',
      sharing: 'unshareable',
      specNote: 'FHS §2 lists /boot as the example of static + unshareable data.',
      examples: ['vmlinuz-6.1.0', 'initrd.img', 'grub/grub.cfg'],
    },
    {
      path: '/dev',
      summary: 'Device files',
      detail:
        'Character and block device nodes through which programs talk to hardware, plus pseudo-devices. Populated at runtime by devtmpfs/udev, so its contents vanish on reboot.',
      persistence: 'variable',
      sharing: 'unshareable',
      examples: ['sda', 'null', 'zero', 'random', 'tty0'],
    },
    {
      path: '/etc',
      summary: 'Host-specific system configuration',
      detail:
        'Configuration for this machine only. No binaries are allowed here. Because the values are host-specific it cannot be shared, but it only changes under administrator action, so it counts as static.',
      persistence: 'static',
      sharing: 'unshareable',
      specNote: 'FHS §2 lists /etc as the example of static + unshareable data.',
      examples: ['passwd', 'fstab', 'hosts', 'ssh/sshd_config', 'systemd/'],
      children: [
        {
          path: '/etc/opt',
          summary: 'Configuration files for /opt',
          detail:
            'Add-on packages installed under /opt keep their host-specific configuration here rather than inside their own directory, so /opt stays shareable and read-only.',
          persistence: 'static',
          sharing: 'unshareable',
          examples: ['/etc/opt/vendor-app/settings.conf'],
        },
      ],
    },
    {
      path: '/home',
      summary: 'User home directories',
      detail:
        'One directory per user, each holding documents, dotfiles, and per-user config. Optional in the standard, but present on effectively every Linux system, and commonly mounted over NFS for shared accounts.',
      persistence: 'variable',
      sharing: 'shareable',
      specNote: 'FHS §2: "the files in user home directories are shareable".',
      examples: ['/home/alice', '/home/bob'],
      children: [
        {
          path: '/home/user',
          summary: 'A single user account (example)',
          detail:
            'Expanded by the shell as ~. Holds user documents, per-user configuration as dotfiles or under the XDG directories, and per-user caches and data.',
          persistence: 'variable',
          sharing: 'shareable',
          examples: ['.bashrc', '.ssh/', '.config/', '.local/share/', 'Documents/'],
        },
      ],
    },
    {
      path: '/lib',
      summary: 'Essential shared libraries and kernel modules',
      detail:
        'Libraries required to boot and to run the binaries in /bin and /sbin, plus kernel modules. Merged-/usr systems symlink it to /usr/lib.',
      persistence: 'static',
      sharing: 'unshareable',
      examples: ['libc.so.6', 'ld-linux-x86-64.so.2', 'modules/'],
    },
    {
      path: '/media',
      summary: 'Mount point for removable media',
      detail:
        'Where removable devices get mounted automatically — USB sticks, SD cards, optical discs — usually one subdirectory per device or per user.',
      persistence: 'variable',
      sharing: 'unshareable',
      examples: ['/media/usb', '/media/cdrom'],
    },
    {
      path: '/mnt',
      summary: 'Mount point for mounting a filesystem temporarily',
      detail:
        'Reserved for the administrator to mount something by hand. Software must not use it, since the contents are transient by definition.',
      persistence: 'variable',
      sharing: 'unshareable',
      examples: ['mount /dev/sdb1 /mnt'],
    },
    {
      path: '/opt',
      summary: 'Add-on application software packages',
      detail:
        'Self-contained third-party software, one directory per package or vendor, kept out of the distribution-managed hierarchy. Its variable data goes in /var/opt and its configuration in /etc/opt.',
      persistence: 'static',
      sharing: 'shareable',
      specNote: 'FHS §2 lists /opt as an example of static + shareable data.',
      examples: ['/opt/google/chrome', '/opt/vendor-app'],
    },
    {
      path: '/proc',
      summary: 'Process and kernel information (procfs)',
      detail:
        'A virtual filesystem generated by the kernel: no bytes on disk. One numbered directory per running process, plus kernel state and tunables.',
      persistence: 'variable',
      sharing: 'unshareable',
      examples: ['/proc/1/status', 'cpuinfo', 'meminfo', 'sys/'],
    },
    {
      path: '/root',
      summary: 'Home directory for the root user',
      detail:
        "Kept on the root filesystem rather than under /home so the superuser can still log in when /home is unmounted or its server is unreachable.",
      persistence: 'variable',
      sharing: 'unshareable',
      examples: ['/root/.bashrc', '/root/.ssh/'],
    },
    {
      path: '/run',
      summary: 'Data relevant to running processes',
      detail:
        'Runtime state since early boot — PID files, sockets, lock files. Mounted as tmpfs, so it starts empty on every boot. /var/run is now usually a symlink here.',
      persistence: 'variable',
      sharing: 'unshareable',
      examples: ['sshd.pid', 'systemd/', 'user/1000/', 'lock/'],
    },
    {
      path: '/sbin',
      summary: 'Essential system binaries',
      detail:
        'Administration binaries needed for booting, restoring, and repairing, alongside those in /bin. Normally only useful to root, and on merged-/usr systems a symlink to /usr/sbin.',
      persistence: 'static',
      sharing: 'unshareable',
      examples: ['fsck', 'mount', 'ip', 'init', 'reboot'],
    },
    {
      path: '/srv',
      summary: 'Data for services provided by this system',
      detail:
        'Site-specific data served out by this host, organised per protocol or service. It gives a stable location for service payloads instead of scattering them across /var.',
      persistence: 'variable',
      sharing: 'unshareable',
      examples: ['/srv/www', '/srv/ftp', '/srv/git'],
    },
    {
      path: '/sys',
      summary: 'Kernel and device tree (sysfs)',
      detail:
        'Another kernel-generated virtual filesystem, exposing devices, drivers, and buses as a hierarchy. Many attributes are writable, which is how device tuning is done at runtime.',
      persistence: 'variable',
      sharing: 'unshareable',
      examples: ['class/', 'block/', 'devices/', 'kernel/'],
    },
    {
      path: '/tmp',
      summary: 'Temporary files',
      detail:
        'Scratch space for any program or user. Programs must not assume files survive a reboot, and many systems mount it as tmpfs or clear it at boot.',
      persistence: 'variable',
      sharing: 'unshareable',
      examples: ['/tmp/tmp.XyZ123', 'systemd-private-*/'],
    },
    {
      path: '/usr',
      summary: 'Secondary hierarchy',
      detail:
        'The bulk of the system: all installed programs, libraries, and shared data. FHS requires it be shareable and read-only — nothing host-specific or time-varying belongs here, which is exactly why /var exists.',
      persistence: 'static',
      sharing: 'shareable',
      specNote: 'FHS §4.1: "/usr is shareable, read-only data"; §2 lists it as static + shareable.',
      examples: [],
      children: [
        {
          path: '/usr/bin',
          summary: 'Most user commands',
          detail:
            'The primary directory for executables — everything not required for early boot or emergency repair. The largest binary directory on a typical system.',
          persistence: 'static',
          sharing: 'shareable',
          examples: ['python3', 'git', 'gcc', 'ssh', 'vim'],
        },
        {
          path: '/usr/lib',
          summary: 'Libraries for programming and packages',
          detail:
            'Shared libraries and internal binaries that users do not invoke directly, plus per-package support directories. Multi-arch systems may add /usr/lib64 or /usr/lib/x86_64-linux-gnu.',
          persistence: 'static',
          sharing: 'shareable',
          examples: ['libssl.so.3', 'systemd/', 'python3.11/'],
        },
        {
          path: '/usr/local',
          summary: 'Local hierarchy (empty after main installation)',
          detail:
            'Reserved for software the administrator installs by hand, so it is never overwritten by package updates. Mirrors the layout of /usr with its own bin, lib, and share.',
          persistence: 'static',
          sharing: 'shareable',
          examples: ['/usr/local/bin', '/usr/local/lib', '/usr/local/share'],
          children: [
            {
              path: '/usr/local/bin',
              summary: 'Locally installed commands',
              detail:
                'Where `make install` and hand-built tools land by default. It usually precedes /usr/bin in PATH, so a local build shadows the packaged version.',
              persistence: 'static',
              sharing: 'shareable',
              examples: ['/usr/local/bin/my-tool'],
            },
          ],
        },
        {
          path: '/usr/sbin',
          summary: 'Non-vital system binaries',
          detail:
            'System administration binaries that are not required for booting or repairing — services and their management tools.',
          persistence: 'static',
          sharing: 'shareable',
          examples: ['sshd', 'nginx', 'useradd', 'cron'],
        },
        {
          path: '/usr/share',
          summary: 'Architecture-independent data',
          detail:
            'Everything that is identical on every architecture: documentation, man pages, icons, fonts, locales, and per-package data files. Safe to share between hosts of different CPU types.',
          persistence: 'static',
          sharing: 'shareable',
          examples: ['man/', 'doc/', 'icons/', 'locale/', 'zoneinfo/'],
        },
        {
          path: '/usr/include',
          summary: 'Header files included by C programs',
          detail:
            'The system header files used when compiling against installed libraries. Optional in the standard, but present wherever a toolchain is installed.',
          persistence: 'static',
          sharing: 'shareable',
          examples: ['stdio.h', 'stdlib.h', 'sys/socket.h'],
        },
        {
          path: '/usr/src',
          summary: 'Source code (optional)',
          detail:
            'Reference source code, most often kernel headers and sources used to build out-of-tree modules.',
          persistence: 'static',
          sharing: 'shareable',
          examples: ['linux-headers-6.1.0/'],
        },
      ],
    },
    {
      path: '/var',
      summary: 'Variable data',
      detail:
        'Everything that changes while the system runs: logs, spools, caches, and service state. It exists precisely so /usr can be mounted read-only — anything written during normal operation must live here.',
      persistence: 'variable',
      sharing: 'unshareable',
      specNote: 'FHS §5.1: /var exists to make it possible to mount /usr read-only.',
      examples: [],
      children: [
        {
          path: '/var/cache',
          summary: 'Application cache data',
          detail:
            'Regenerable intermediate data kept to save time. Deleting it must never break an application — only slow it down. Portions such as man and font caches may be shared between hosts.',
          persistence: 'variable',
          sharing: 'shareable',
          specNote: 'FHS §5.1 names /var/cache/man and /var/cache/fonts as shareable.',
          examples: ['apt/', 'man/', 'fontconfig/'],
        },
        {
          path: '/var/lib',
          summary: 'Variable state information',
          detail:
            'Persistent state owned by applications and the system — databases, package manager state, service data that must survive reboots.',
          persistence: 'variable',
          sharing: 'unshareable',
          examples: ['dpkg/', 'postgresql/', 'docker/', 'systemd/'],
        },
        {
          path: '/var/local',
          summary: 'Variable data for /usr/local',
          detail: 'Runtime and state data belonging to locally installed software under /usr/local.',
          persistence: 'variable',
          sharing: 'unshareable',
          examples: [],
        },
        {
          path: '/var/lock',
          summary: 'Lock files',
          detail:
            'Files marking a device or resource as in use, so two programs do not drive the same serial port or device at once. Now typically a symlink into /run/lock.',
          persistence: 'variable',
          sharing: 'unshareable',
          specNote: 'FHS §2 lists /var/lock as an example of variable + unshareable data.',
          examples: ['LCK..ttyS0'],
        },
        {
          path: '/var/log',
          summary: 'Log files and directories',
          detail:
            'System and service logs. Strictly host-specific, and the first place to look when something breaks. Rotated by logrotate or held in the systemd journal.',
          persistence: 'variable',
          sharing: 'unshareable',
          specNote: 'FHS §5.1 names /var/log as not shareable between systems.',
          examples: ['syslog', 'auth.log', 'nginx/access.log', 'journal/'],
        },
        {
          path: '/var/opt',
          summary: 'Variable data for /opt',
          detail:
            'Runtime data written by add-on packages, keeping the /opt hierarchy itself read-only and shareable.',
          persistence: 'variable',
          sharing: 'unshareable',
          examples: ['/var/opt/vendor-app/data'],
        },
        {
          path: '/var/run',
          summary: 'Data relevant to running processes',
          detail:
            'The historical location for PID files and sockets. Modern systems make it a symlink to /run, which is a tmpfs available earlier in boot.',
          persistence: 'variable',
          sharing: 'unshareable',
          specNote: 'FHS §2 lists /var/run as an example of variable + unshareable data.',
          examples: ['→ /run'],
        },
        {
          path: '/var/spool',
          summary: 'Application spool data',
          detail:
            'Queues of work waiting to be processed — mail, print jobs, cron tables. Entries are normally deleted once the work is done.',
          persistence: 'variable',
          sharing: 'unshareable',
          examples: ['cron/', 'cups/', 'mail/'],
        },
        {
          path: '/var/mail',
          summary: 'User mailbox files',
          detail:
            'Incoming mail spools, one per user. Explicitly shareable so several hosts can serve the same mailboxes.',
          persistence: 'variable',
          sharing: 'shareable',
          specNote: 'FHS §2 lists /var/mail as an example of variable + shareable data.',
          examples: ['/var/mail/alice'],
        },
        {
          path: '/var/tmp',
          summary: 'Temporary files preserved between system reboots',
          detail:
            'Like /tmp, but not cleared at boot — the right place for larger, longer-lived scratch data.',
          persistence: 'variable',
          sharing: 'unshareable',
          examples: ['/var/tmp/build-cache'],
        },
      ],
    },
  ],
};
