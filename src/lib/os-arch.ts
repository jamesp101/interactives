export type Space = 'user' | 'kernel' | 'firmware' | 'hardware';
export type Role = 'apps' | 'ui' | 'runtime' | 'libs' | 'syscall' | 'kernel' | 'drivers' | 'firmware' | 'hardware';

export interface Layer {
  role: Role;
  name: string;
  space: Space;
  detail: string;
  components: string[];
}

export interface OsKey {
  id: 'linux' | 'macos' | 'windows' | 'android' | 'ios';
  name: string;
  tint: string;
  kernel: string;
  lineage: string;
  summary: string;
  layers: Layer[];
}

export const ROLE_LABELS: Record<Role, string> = {
  apps: 'applications',
  ui: 'UI & graphics',
  runtime: 'runtime & services',
  libs: 'system libraries',
  syscall: 'syscall boundary',
  kernel: 'kernel',
  drivers: 'drivers',
  firmware: 'firmware & boot',
  hardware: 'hardware',
};

export const OSES: OsKey[] = [
  {
    id: 'linux',
    name: 'Linux',
    tint: '#f2b134',
    kernel: 'Monolithic (modular)',
    lineage: 'Unix-like, written from scratch in 1991',
    summary:
      'One big kernel binary with loadable modules, and the only kernel here that treats its raw syscall ABI as a permanent public contract.',
    layers: [
      {
        role: 'apps',
        name: 'Applications',
        space: 'user',
        detail:
          'ELF binaries launched by a shell or desktop. Nothing stands between an app and the kernel except libc — an app may issue raw syscalls itself and remain supported forever.',
        components: ['ELF executables', 'shell, CLI tools', 'Flatpak / Snap sandboxes'],
      },
      {
        role: 'ui',
        name: 'Desktop stack',
        space: 'user',
        detail:
          'Entirely user space and entirely replaceable: the compositor, toolkit, and even the display protocol are separate projects. The kernel contributes only mode-setting and GPU memory management through DRM/KMS.',
        components: ['Wayland / X11', 'GNOME, KDE', 'GTK, Qt', 'Mesa, Vulkan'],
      },
      {
        role: 'runtime',
        name: 'Init & system services',
        space: 'user',
        detail:
          'PID 1 supervises services, sockets, and mounts. IPC is conventional Unix: sockets, pipes, shared memory, with D-Bus layered on top as a userspace convention rather than a kernel primitive.',
        components: ['systemd / OpenRC', 'D-Bus', 'PipeWire', 'udev'],
      },
      {
        role: 'libs',
        name: 'C library',
        space: 'user',
        detail:
          'glibc wraps syscalls, but it is not privileged: it is one implementation among several, and statically linked binaries can skip it entirely.',
        components: ['glibc / musl', 'ld.so', 'libstdc++'],
      },
      {
        role: 'syscall',
        name: 'Stable syscall ABI',
        space: 'user',
        detail:
          'The defining Linux property: "we do not break userspace." Syscall numbers and semantics are frozen once released, so a binary compiled in 2005 still runs. Every other system here reserves the right to change this boundary.',
        components: ['syscall instruction', '~400 stable syscalls', 'vDSO fast paths'],
      },
      {
        role: 'kernel',
        name: 'Linux kernel',
        space: 'kernel',
        detail:
          'Monolithic: scheduler, memory manager, VFS, and the whole network stack share one address space for speed. Modularity comes from loadable modules rather than from separate address spaces, so a driver bug can take down the machine.',
        components: ['EEVDF scheduler', 'VFS', 'netfilter / TCP-IP', 'cgroups, namespaces', 'eBPF'],
      },
      {
        role: 'drivers',
        name: 'Kernel modules',
        space: 'kernel',
        detail:
          'Drivers are kernel modules with no stable in-kernel ABI, which is deliberate: it pushes drivers upstream into the tree, where they are rebuilt with the kernel. Out-of-tree drivers must be recompiled for every kernel.',
        components: ['.ko modules', 'DRM/KMS', 'no stable kernel ABI', 'FUSE (user space)'],
      },
      {
        role: 'firmware',
        name: 'UEFI / bootloader',
        space: 'firmware',
        detail:
          'Firmware loads a bootloader, which loads a kernel image plus an initramfs. Secure Boot is optional and user-controllable — the owner holds the keys.',
        components: ['UEFI / coreboot', 'GRUB / systemd-boot', 'vmlinuz + initramfs'],
      },
      { role: 'hardware', name: 'Hardware', space: 'hardware', detail: 'Commodity hardware across every architecture Linux is ported to — x86-64, ARM, RISC-V, s390x.', components: [] },
    ],
  },
  {
    id: 'macos',
    name: 'macOS',
    tint: '#5b8dee',
    kernel: 'XNU hybrid (Mach + BSD)',
    lineage: 'Mach + BSD → NeXTSTEP → Darwin, 2001',
    summary:
      'A Mach microkernel core and a BSD personality fused into one kernel binary, with drivers steadily migrating out of the kernel into user space.',
    layers: [
      {
        role: 'apps',
        name: 'Applications',
        space: 'user',
        detail:
          'Mach-O bundles. Signing and notarization are enforced by Gatekeeper, but the system still permits unsigned binaries the user explicitly approves — the key difference from iOS.',
        components: ['.app bundles', 'Mach-O', 'Gatekeeper, notarization'],
      },
      {
        role: 'ui',
        name: 'AppKit & Quartz',
        space: 'user',
        detail:
          'Apps never touch the framebuffer. They hand layer trees to Core Animation, and a separate privileged process — WindowServer — composites every window on the GPU through Metal.',
        components: ['SwiftUI / AppKit', 'Core Animation', 'WindowServer', 'Metal'],
      },
      {
        role: 'runtime',
        name: 'launchd & XPC',
        space: 'user',
        detail:
          'launchd is PID 1 and the only thing that spawns daemons. Services talk over XPC, which rides on Mach ports — so the microkernel heritage is visible in everyday app IPC.',
        components: ['launchd', 'XPC services', 'Core Foundation', 'Obj-C / Swift runtime'],
      },
      {
        role: 'libs',
        name: 'libSystem',
        space: 'user',
        detail:
          'One dylib provides libc, pthreads, and libdispatch (Grand Central Dispatch). Linking it is mandatory — it is the only supported doorway to the kernel.',
        components: ['libSystem.dylib', 'dyld shared cache', 'libdispatch'],
      },
      {
        role: 'syscall',
        name: 'Private syscall ABI',
        space: 'user',
        detail:
          'Two trap families: BSD syscalls for POSIX, and Mach traps for ports, VM, and IPC. Neither is a stable contract — Apple renumbers freely between releases, so bypassing libSystem breaks on upgrade.',
        components: ['BSD syscalls', 'Mach traps', 'unstable — link libSystem'],
      },
      {
        role: 'kernel',
        name: 'XNU',
        space: 'kernel',
        detail:
          'Hybrid, not micro: Mach supplies IPC, virtual memory, and scheduling primitives while the BSD layer supplies processes, signals, VFS, and sockets — but both run in one address space, so Mach messages do not pay a context-switch tax for in-kernel calls.',
        components: ['Mach core (ports, VM)', 'BSD layer (POSIX, VFS)', 'IOKit (C++ runtime)'],
      },
      {
        role: 'drivers',
        name: 'DriverKit & IOKit',
        space: 'user',
        detail:
          'The big architectural shift: since macOS 10.15 third-party drivers are DriverKit system extensions running in USER space, where a crash cannot panic the kernel. Kernel extensions still exist but are deprecated and require reduced security to load.',
        components: ['DriverKit (user space)', 'System Extensions', 'IOKit', 'kexts — deprecated'],
      },
      {
        role: 'firmware',
        name: 'iBoot / Secure Boot',
        space: 'firmware',
        detail:
          'On Apple silicon the same iBoot chain as iPhone runs, with the Secure Enclave holding keys. Unlike iOS, the boot policy is downgradable per-volume, which is what makes third-party kernels possible at all.',
        components: ['iBoot', 'Secure Enclave', 'boot policy (per volume)'],
      },
      { role: 'hardware', name: 'Hardware', space: 'hardware', detail: 'Apple silicon (arm64) with fixed, first-party SoC designs; Intel Macs are the outgoing generation.', components: [] },
    ],
  },
  {
    id: 'windows',
    name: 'Windows',
    tint: '#3ddc84',
    kernel: 'NT hybrid (layered executive)',
    lineage: 'NT, 1993 — VMS-influenced, not Unix-derived',
    summary:
      'The only system here with no Unix ancestry: a layered executive with pluggable subsystems, where the documented API is a DLL surface and the syscalls beneath it are deliberately private.',
    layers: [
      {
        role: 'apps',
        name: 'Applications',
        space: 'user',
        detail:
          'PE/COFF binaries. Backwards compatibility is the architectural obsession: decades-old executables still run, which is why so much structure here is frozen in place.',
        components: ['PE/COFF .exe', 'MSIX packages', 'AppContainer sandbox'],
      },
      {
        role: 'ui',
        name: 'Win32 & DirectX',
        space: 'user',
        detail:
          'Unusual among modern systems: part of the window manager lives in the KERNEL. win32k.sys handles windowing and GDI in kernel mode, a performance decision from NT 4.0 that remains a recurring source of privilege-escalation bugs.',
        components: ['WinUI 3 / Win32', 'user32, GDI', 'win32k.sys (kernel)', 'DirectX, DWM'],
      },
      {
        role: 'runtime',
        name: 'Subsystems & services',
        space: 'user',
        detail:
          'NT was designed to host multiple OS personalities on one kernel. Win32 is simply the surviving subsystem — and the same mechanism is why WSL can host Linux processes natively.',
        components: ['csrss.exe (Win32)', 'services.exe', 'COM / WinRT', '.NET CLR', 'WSL'],
      },
      {
        role: 'libs',
        name: 'kernel32 → ntdll',
        space: 'user',
        detail:
          'Two layers: the documented Win32 DLLs, and ntdll.dll underneath holding the actual syscall stubs. Everything funnels through ntdll to reach the kernel.',
        components: ['kernel32 / kernelbase.dll', 'ntdll.dll', 'MSVCRT / UCRT'],
      },
      {
        role: 'syscall',
        name: 'Private NT syscalls',
        space: 'user',
        detail:
          'Syscall numbers are undocumented and shuffle between builds — even between updates of the same release. The stable contract is the Win32 API, one level up, which is the opposite of the Linux arrangement.',
        components: ['syscall via ntdll', 'numbers shift per build', 'Win32 API is the contract'],
      },
      {
        role: 'kernel',
        name: 'NT executive',
        space: 'kernel',
        detail:
          'Layered and object-based: nearly everything — files, processes, events, registry keys — is an object with a handle, a security descriptor, and a reference count, managed by the Object Manager. Beneath the executive, the HAL abstracts the board.',
        components: ['Object Manager', 'Memory Manager', 'I/O Manager (IRPs)', 'HAL', 'Registry'],
      },
      {
        role: 'drivers',
        name: 'WDM / KMDF / UMDF',
        space: 'kernel',
        detail:
          'Drivers receive I/O Request Packets and are stacked as filters — antivirus, encryption, and storage filters all insert themselves into the same chain. Unlike Linux, the driver ABI is stable, so vendors ship binary drivers; UMDF moves some classes to user space.',
        components: ['WDM / KMDF (kernel)', 'UMDF (user space)', 'WDDM for GPUs', 'stable driver ABI'],
      },
      {
        role: 'firmware',
        name: 'UEFI boot chain',
        space: 'firmware',
        detail:
          'UEFI hands off to the boot manager and loader, with Secure Boot, BitLocker, and virtualization-based security establishing the trust chain before the kernel runs.',
        components: ['UEFI + Secure Boot', 'bootmgr → winload', 'VBS / HVCI (Hyper-V)'],
      },
      { role: 'hardware', name: 'Hardware', space: 'hardware', detail: 'Open hardware ecosystem — arbitrary x86-64 and increasingly Arm64 machines from any vendor.', components: [] },
    ],
  },
  {
    id: 'android',
    name: 'Android',
    tint: '#9b5de5',
    kernel: 'Linux (monolithic) + Android extensions',
    lineage: 'Linux kernel, Android 1.0 in 2008',
    summary:
      'A Linux kernel carrying Android-specific subsystems, under a managed runtime — and split down the middle so the OS and the vendor hardware code can be updated independently.',
    layers: [
      {
        role: 'apps',
        name: 'Applications',
        space: 'user',
        detail:
          'Each app is a separate Linux UID. The classic Unix multi-user model is repurposed: instead of separating people, it separates apps from each other on a single-user device.',
        components: ['APK (DEX + native libs)', 'one UID per app', 'runtime permissions'],
      },
      {
        role: 'ui',
        name: 'SurfaceFlinger',
        space: 'user',
        detail:
          'Apps render into their own buffers, then hand them to SurfaceFlinger via BufferQueue for composition. Hardware Composer offloads the final blend to display hardware to save power.',
        components: ['Jetpack Compose / Views', 'Skia / HWUI', 'SurfaceFlinger', 'Hardware Composer HAL'],
      },
      {
        role: 'runtime',
        name: 'ART, Zygote & system_server',
        space: 'user',
        detail:
          'Zygote is the trick: one warm VM with the framework preloaded sits idle, and every app launch is a fork of it, so shared pages are inherited copy-on-write and startup is cheap. system_server hosts the framework services apps actually talk to.',
        components: ['ART (AOT + JIT)', 'Zygote fork', 'system_server', 'ActivityManager'],
      },
      {
        role: 'libs',
        name: 'bionic & libbinder',
        space: 'user',
        detail:
          'bionic is a deliberately small BSD-licensed libc, not glibc. Native code reaches the system only through the NDK — a curated subset, because most of the platform is off-limits to apps.',
        components: ['bionic libc', 'NDK (stable subset)', 'libbinder'],
      },
      {
        role: 'syscall',
        name: 'Linux syscalls, fenced in',
        space: 'user',
        detail:
          'The syscall interface is ordinary Linux, but apps are confined above it: seccomp filters restrict what an app process may call, and SELinux policy governs what it may touch.',
        components: ['Linux syscalls via bionic', 'seccomp-bpf filter', 'SELinux enforcing'],
      },
      {
        role: 'kernel',
        name: 'Linux + Android subsystems',
        space: 'kernel',
        detail:
          'Mainline Linux plus additions written for phones: Binder for IPC, dmabuf for zero-copy buffer sharing, wakelocks for suspend control, and a low-memory killer. The Generic Kernel Image freezes one kernel ABI so vendor modules load against it.',
        components: ['Binder driver', 'dmabuf / ION', 'wakelocks', 'GKI + vendor modules'],
      },
      {
        role: 'drivers',
        name: 'HALs behind AIDL',
        space: 'user',
        detail:
          'Project Treble moved hardware code into user-space HAL processes on a separate /vendor partition, talking to the framework over versioned interfaces (AIDL since Android 11, replacing HIDL). That split is what lets the OS be updated without the vendor recompiling drivers.',
        components: ['HAL processes (/vendor)', 'stable AIDL (since 11)', 'HIDL (legacy, from Treble)', 'kernel drivers'],
      },
      {
        role: 'firmware',
        name: 'Verified Boot & TEE',
        space: 'firmware',
        detail:
          'The bootloader verifies each stage with Android Verified Boot. Alongside the main OS, a TrustZone secure world runs Keymaster/KeyMint for key storage and attestation.',
        components: ['bootloader', 'AVB', 'TrustZone TEE', 'KeyMint'],
      },
      { role: 'hardware', name: 'Hardware', space: 'hardware', detail: 'Thousands of Arm SoC designs from many vendors — the fragmentation Treble exists to absorb.', components: [] },
    ],
  },
  {
    id: 'ios',
    name: 'iOS',
    tint: '#e4572e',
    kernel: 'XNU hybrid (same Darwin core)',
    lineage: 'Darwin — shares XNU with macOS, 2007',
    summary:
      'Architecturally the same kernel as macOS; the differences are policy, hardening, and what user space is permitted to do — not a different design.',
    layers: [
      {
        role: 'apps',
        name: 'Applications',
        space: 'user',
        detail:
          'Every app runs in a mandatory sandbox with its own container. Code signing is enforced by the kernel at page-fault time, so an app cannot generate or load unsigned code — the JIT exception is granted only to the system browser engine.',
        components: ['Mach-O in sandbox container', 'mandatory code signing', 'no fork() for apps'],
      },
      {
        role: 'ui',
        name: 'UIKit & Core Animation',
        space: 'user',
        detail:
          'Same design as macOS: layer trees go to a separate render server that composites with Metal. Because the hardware is fixed, the compositor can rely on exact display and GPU behaviour.',
        components: ['SwiftUI / UIKit', 'Core Animation', 'render server', 'Metal'],
      },
      {
        role: 'runtime',
        name: 'launchd & SpringBoard',
        space: 'user',
        detail:
          'launchd still runs everything, with SpringBoard as the shell. The app lifecycle is dictated by the system: background execution is granted in narrow slices rather than assumed, which is the core power-management difference from a desktop.',
        components: ['launchd', 'SpringBoard / FrontBoard', 'XPC', 'background modes'],
      },
      {
        role: 'libs',
        name: 'libSystem',
        space: 'user',
        detail:
          'Identical to macOS, including the dyld shared cache — one prelinked image of every system library, mapped into each process to cut launch time and memory.',
        components: ['libSystem.dylib', 'dyld shared cache'],
      },
      {
        role: 'syscall',
        name: 'Private, sandbox-checked',
        space: 'user',
        detail:
          'The same BSD and Mach traps as macOS, with a mandatory access control layer above them: every sensitive operation is checked against the sandbox profile before the kernel performs it.',
        components: ['BSD syscalls, Mach traps', 'Sandbox (MACF) checks', 'entitlement checks'],
      },
      {
        role: 'kernel',
        name: 'XNU, hardened',
        space: 'kernel',
        detail:
          'The same Mach + BSD + IOKit kernel as macOS, plus silicon-assisted hardening: kernel text is locked read-only after boot (KTRR), pointers are signed (PAC), and a page protection layer gatekeeps page-table writes.',
        components: ['Mach + BSD + IOKit', 'KTRR / PPL', 'Pointer Authentication', 'no third-party kexts'],
      },
      {
        role: 'drivers',
        name: 'First-party drivers only',
        space: 'kernel',
        detail:
          'There is no third-party driver story on iPhone at all — the kernel loads only Apple drivers. DriverKit exists on iPadOS for M-series devices, again in user space.',
        components: ['Apple IOKit drivers', 'DriverKit (iPadOS, M-series)', 'no kext loading'],
      },
      {
        role: 'firmware',
        name: 'iBoot chain of trust',
        space: 'firmware',
        detail:
          'An unbroken signature chain from the immutable Boot ROM through iBoot to the kernel, anchored in hardware. The Secure Enclave is a separate coprocessor with its own OS that the main kernel cannot read into.',
        components: ['Boot ROM (immutable)', 'iBoot', 'Secure Enclave (own OS)', 'no boot policy downgrade'],
      },
      { role: 'hardware', name: 'Hardware', space: 'hardware', detail: 'Apple silicon only, co-designed with the OS — a fixed target no other system here enjoys.', components: [] },
    ],
  },
];

export interface Hop {
  role: Role;
  label: string;
  detail: string;
}

export interface Operation {
  id: string;
  name: string;
  question: string;
  paths: Record<OsKey['id'], Hop[]>;
}

export const OPERATIONS: Operation[] = [
  {
    id: 'file',
    name: 'read a file',
    question: 'What happens between an app asking for bytes and a disk delivering them?',
    paths: {
      linux: [
        { role: 'apps', label: 'app calls open("/tmp/a")', detail: 'Ordinary C call, or a raw syscall if the app prefers.' },
        { role: 'libs', label: 'glibc open() wrapper', detail: 'Thin wrapper: load the syscall number, execute the trap.' },
        { role: 'syscall', label: 'syscall → sys_openat', detail: 'Stable syscall number 257. This boundary has not moved in years.' },
        { role: 'kernel', label: 'VFS → ext4', detail: 'The VFS layer dispatches to whichever filesystem backs the mount.' },
        { role: 'drivers', label: 'block layer → NVMe module', detail: 'I/O scheduler queues the request to the driver module.' },
        { role: 'hardware', label: 'SSD returns blocks', detail: 'DMA into kernel page cache, copied to the app buffer.' },
      ],
      macos: [
        { role: 'apps', label: 'app calls fopen / NSFileHandle', detail: 'Foundation ultimately calls the same POSIX entry point.' },
        { role: 'libs', label: 'libSystem open() stub', detail: 'The only supported route — the trap below it is private.' },
        { role: 'syscall', label: 'BSD syscall trap', detail: 'Enters the BSD personality of XNU, not the Mach side.' },
        { role: 'kernel', label: 'VFS → APFS', detail: 'BSD-derived VFS, with APFS copy-on-write beneath it.' },
        { role: 'drivers', label: 'IOKit storage stack', detail: 'IOKit driver objects, matched against the device tree at boot.' },
        { role: 'hardware', label: 'NVMe controller returns blocks', detail: 'On Apple silicon, storage is attached to the SoC.' },
      ],
      windows: [
        { role: 'apps', label: 'app calls CreateFileW', detail: 'The documented Win32 entry point — the stable contract.' },
        { role: 'libs', label: 'kernel32 → ntdll!NtCreateFile', detail: 'Win32 translates paths, then calls the private NT layer.' },
        { role: 'syscall', label: 'syscall → NT executive', detail: 'Syscall number is build-specific and undocumented.' },
        { role: 'kernel', label: 'I/O Manager builds an IRP', detail: 'The request becomes a packet passed down a driver stack.' },
        { role: 'drivers', label: 'filter drivers → NTFS → storport', detail: 'Antivirus and encryption filters see the IRP on the way through.' },
        { role: 'hardware', label: 'disk controller returns blocks', detail: 'Completion travels back up the same stack.' },
      ],
      android: [
        { role: 'apps', label: 'app calls FileInputStream', detail: 'Java API in ART, checked against the app sandbox.' },
        { role: 'libs', label: 'bionic open()', detail: 'JNI drops into bionic, Android’s small libc.' },
        { role: 'syscall', label: 'svc → sys_openat (seccomp)', detail: 'Ordinary Linux syscall, filtered by seccomp first.' },
        { role: 'kernel', label: 'SELinux check → VFS → ext4/F2FS', detail: 'SELinux policy decides before the filesystem is consulted.' },
        { role: 'drivers', label: 'block layer → UFS driver', detail: 'Kernel driver for the phone’s UFS storage.' },
        { role: 'hardware', label: 'UFS returns blocks', detail: 'File-based encryption decrypts per-file on the way up.' },
      ],
      ios: [
        { role: 'apps', label: 'app calls FileManager', detail: 'Paths are confined to the app’s container.' },
        { role: 'libs', label: 'libSystem open() stub', detail: 'Same libSystem as macOS.' },
        { role: 'syscall', label: 'BSD trap → sandbox check', detail: 'MACF hooks evaluate the sandbox profile before proceeding.' },
        { role: 'kernel', label: 'VFS → APFS + Data Protection', detail: 'Per-file keys are unwrapped by the Secure Enclave.' },
        { role: 'drivers', label: 'Apple NVMe (IOKit)', detail: 'First-party driver; no third-party code on this path.' },
        { role: 'hardware', label: 'storage returns blocks', detail: 'Hardware crypto engine decrypts inline.' },
      ],
    },
  },
  {
    id: 'frame',
    name: 'draw a frame',
    question: 'Who owns the screen, and how many processes does a pixel pass through?',
    paths: {
      linux: [
        { role: 'apps', label: 'app draws with GTK / Qt', detail: 'Toolkit renders into a client-side buffer.' },
        { role: 'ui', label: 'Wayland client → compositor', detail: 'The app is a client; a separate compositor process owns the screen.' },
        { role: 'ui', label: 'Mesa → GPU commands', detail: 'User-space GPU driver builds the command stream.' },
        { role: 'syscall', label: 'DRM ioctls', detail: 'Buffers and commands are submitted through DRM.' },
        { role: 'drivers', label: 'DRM/KMS driver (amdgpu, i915)', detail: 'Kernel schedules GPU work and programs the display controller.' },
        { role: 'hardware', label: 'GPU scans out', detail: 'Page flip at vblank.' },
      ],
      macos: [
        { role: 'apps', label: 'app updates a view', detail: 'AppKit/SwiftUI marks layers dirty — apps rarely draw pixels directly.' },
        { role: 'ui', label: 'Core Animation layer tree', detail: 'The tree, not the pixels, is what crosses the process boundary.' },
        { role: 'ui', label: 'WindowServer composites', detail: 'A separate privileged process owns the display and blends all windows.' },
        { role: 'libs', label: 'Metal command buffer', detail: 'Composition is itself GPU work.' },
        { role: 'drivers', label: 'IOKit GPU driver', detail: 'Kernel-side submission to Apple silicon GPU.' },
        { role: 'hardware', label: 'display scans out', detail: 'Frame callbacks are paced to the display refresh rate.' },
      ],
      windows: [
        { role: 'apps', label: 'app draws via WinUI / Direct2D', detail: 'Or legacy GDI, which is still supported.' },
        { role: 'ui', label: 'DWM composites', detail: 'The Desktop Window Manager blends every window off-screen.' },
        { role: 'ui', label: 'D3D / DXGI swap chain', detail: 'Presentation goes through the DirectX graphics infrastructure.' },
        { role: 'drivers', label: 'WDDM user-mode driver', detail: 'Vendor code runs in user space here — deliberately, for stability.' },
        { role: 'drivers', label: 'WDDM kernel-mode driver + GPU scheduler', detail: 'Kernel half handles scheduling and memory residency.' },
        { role: 'hardware', label: 'GPU scans out', detail: 'Flip queued to the display engine.' },
      ],
      android: [
        { role: 'apps', label: 'app draws with Compose / Views', detail: 'Recorded as display lists on the UI thread.' },
        { role: 'ui', label: 'RenderThread → Skia (HWUI)', detail: 'Rendering is moved off the UI thread to keep input responsive.' },
        { role: 'ui', label: 'BufferQueue → SurfaceFlinger', detail: 'Buffers are passed, not copied — dmabuf handles cross the boundary.' },
        { role: 'drivers', label: 'Hardware Composer HAL', detail: 'HWC decides which layers the display hardware can blend for free.' },
        { role: 'drivers', label: 'DRM/KMS + GPU driver', detail: 'Kernel driver programs the display pipeline.' },
        { role: 'hardware', label: 'panel scans out', detail: 'Choreographer paces the app to vsync.' },
      ],
      ios: [
        { role: 'apps', label: 'app updates a view', detail: 'UIKit/SwiftUI mutate the layer tree.' },
        { role: 'ui', label: 'Core Animation → render server', detail: 'Same split as macOS: a separate process composites.' },
        { role: 'libs', label: 'Metal command buffer', detail: 'Tile-based deferred rendering on Apple GPUs.' },
        { role: 'drivers', label: 'Apple GPU driver (IOKit)', detail: 'First-party only.' },
        { role: 'hardware', label: 'display scans out', detail: 'ProMotion varies refresh rate to save power.' },
      ],
    },
  },
  {
    id: 'launch',
    name: 'launch an app',
    question: 'How is a new process created — and is fork() even involved?',
    paths: {
      linux: [
        { role: 'apps', label: 'shell or desktop requests launch', detail: 'Any process may spawn any other it has permission to.' },
        { role: 'libs', label: 'fork() then execve()', detail: 'The classic Unix two-step: clone the process, then replace its image.' },
        { role: 'syscall', label: 'sys_execve', detail: 'Kernel tears down the old address space.' },
        { role: 'kernel', label: 'ELF loader maps the binary', detail: 'Segments mapped, then control passed to the dynamic linker.' },
        { role: 'libs', label: 'ld.so resolves symbols', detail: 'Shared libraries mapped and relocated lazily.' },
        { role: 'apps', label: 'main() runs', detail: 'No signature check unless the distro adds one.' },
      ],
      macos: [
        { role: 'runtime', label: 'launchd / Dock requests launch', detail: 'launchd is the canonical spawner.' },
        { role: 'libs', label: 'posix_spawn', detail: 'Preferred over fork+exec: Apple frameworks are not fork-safe.' },
        { role: 'syscall', label: 'BSD trap → process creation', detail: 'Kernel creates the task and its Mach port namespace.' },
        { role: 'kernel', label: 'code signature validated', detail: 'Pages are checked against the signature as they fault in.' },
        { role: 'libs', label: 'dyld maps the shared cache', detail: 'System libraries come prelinked as one image.' },
        { role: 'apps', label: 'main() runs', detail: 'Gatekeeper and notarization were checked before this point.' },
      ],
      windows: [
        { role: 'apps', label: 'CreateProcessW', detail: 'One call does what fork+exec does in two — there is no fork.' },
        { role: 'libs', label: 'ntdll!NtCreateUserProcess', detail: 'Win32 call descends into the NT layer.' },
        { role: 'syscall', label: 'syscall → executive', detail: 'Process and thread objects created by the Object Manager.' },
        { role: 'kernel', label: 'section object mapped', detail: 'The PE image is mapped as a section, not read as a file.' },
        { role: 'libs', label: 'ntdll loader resolves imports', detail: 'The loader runs DllMain for each dependent DLL.' },
        { role: 'apps', label: 'WinMain runs', detail: 'Compatibility shims may be injected before this.' },
      ],
      android: [
        { role: 'apps', label: 'Launcher sends an Intent', detail: 'Apps do not spawn each other directly.' },
        { role: 'runtime', label: 'system_server / ActivityManager', detail: 'A privileged service arbitrates every launch.' },
        { role: 'runtime', label: 'Zygote forks', detail: 'The decisive difference: a preloaded VM is forked, so framework pages are shared copy-on-write.' },
        { role: 'syscall', label: 'setuid to the app’s UID', detail: 'The child drops to the app’s own UID and SELinux domain.' },
        { role: 'runtime', label: 'ART loads the DEX', detail: 'No fresh VM startup cost — it was inherited.' },
        { role: 'apps', label: 'Application.onCreate', detail: 'The app never had a main() of its own.' },
      ],
      ios: [
        { role: 'runtime', label: 'SpringBoard requests launch', detail: 'Only the system shell may start apps.' },
        { role: 'runtime', label: 'launchd → FrontBoard', detail: 'launchd performs the spawn on SpringBoard’s behalf.' },
        { role: 'libs', label: 'posix_spawn (never fork)', detail: 'fork() is effectively unavailable to apps on iOS.' },
        { role: 'kernel', label: 'signature + entitlements checked', detail: 'Unsigned pages simply cannot be executed.' },
        { role: 'libs', label: 'dyld shared cache mapped', detail: 'Same prelinked cache design as macOS.' },
        { role: 'apps', label: 'UIApplicationMain', detail: 'Sandbox container mounted before any app code runs.' },
      ],
    },
  },
];

export interface DimensionRow {
  label: string;
  values: Record<OsKey['id'], string>;
}

export const DIMENSIONS: DimensionRow[] = [
  {
    label: 'kernel type',
    values: {
      linux: 'monolithic, modular',
      macos: 'hybrid (Mach + BSD)',
      windows: 'hybrid, layered executive',
      android: 'monolithic (Linux) + extensions',
      ios: 'hybrid (Mach + BSD)',
    },
  },
  {
    label: 'syscall ABI',
    values: {
      linux: 'stable forever',
      macos: 'private — use libSystem',
      windows: 'private — use Win32',
      android: 'stable, but seccomp-fenced',
      ios: 'private + sandbox-checked',
    },
  },
  {
    label: 'driver model',
    values: {
      linux: 'kernel modules, no stable ABI',
      macos: 'DriverKit in user space',
      windows: 'KMDF kernel, stable ABI',
      android: 'user-space HALs over AIDL',
      ios: 'first-party kernel drivers only',
    },
  },
  {
    label: 'primary IPC',
    values: {
      linux: 'sockets, pipes, D-Bus',
      macos: 'Mach ports, XPC',
      windows: 'ALPC, COM',
      android: 'Binder',
      ios: 'Mach ports, XPC',
    },
  },
  {
    label: 'init / PID 1',
    values: { linux: 'systemd', macos: 'launchd', windows: 'wininit → services.exe', android: 'init → Zygote', ios: 'launchd' },
  },
  {
    label: 'process creation',
    values: {
      linux: 'fork() + execve()',
      macos: 'posix_spawn',
      windows: 'CreateProcess (no fork)',
      android: 'fork from Zygote',
      ios: 'posix_spawn (fork barred)',
    },
  },
  {
    label: 'sandbox',
    values: {
      linux: 'namespaces, seccomp, SELinux',
      macos: 'App Sandbox, SIP, TCC',
      windows: 'AppContainer, integrity levels',
      android: 'per-app UID + SELinux',
      ios: 'mandatory sandbox + signing',
    },
  },
  {
    label: 'binary format',
    values: { linux: 'ELF', macos: 'Mach-O', windows: 'PE/COFF', android: 'DEX + ELF', ios: 'Mach-O' },
  },
  {
    label: 'default filesystem',
    values: { linux: 'ext4 / btrfs', macos: 'APFS', windows: 'NTFS', android: 'ext4 / F2FS', ios: 'APFS' },
  },
];
