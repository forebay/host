& {
$ErrorActionPreference = 'Stop'

# rendered from src/install/runtime-pin.ts by scripts/render-install-scripts.mjs; edit the pin there
$RuntimeName = 'node'
$RuntimeVersion = '26.13.0'
$RuntimeCompatibleMajor = 20
$RuntimeBuilds = @{
    'win32-x64' = @{ Url = 'https://nodejs.org/dist/v26.13.0/node-v26.13.0-win-x64.zip'; Sha256 = 'dcc60d59a0746999f99064a01c020445d54d84228c691cdbf25b49ac3b59150a'; Archive = 'zip' }
    'linux-x64' = @{ Url = 'https://nodejs.org/dist/v26.13.0/node-v26.13.0-linux-x64.tar.gz'; Sha256 = '5848553868b402d3fabb5b09270649977780a390f832155721025a08b5104455'; Archive = 'tar.gz' }
    'darwin-x64' = @{ Url = 'https://nodejs.org/dist/v26.13.0/node-v26.13.0-darwin-x64.tar.gz'; Sha256 = '525c9b29bb0263d687de60a4cec0e2a6db876a8eb032369e5795eca71e7c358e'; Archive = 'tar.gz' }
    'darwin-arm64' = @{ Url = 'https://nodejs.org/dist/v26.13.0/node-v26.13.0-darwin-arm64.tar.gz'; Sha256 = 'd38bd5e5a2ddce6bbb5ce45e46e208337da4d51fffe611e567fd32073d6439f6'; Archive = 'tar.gz' }
}
# end of rendered pins

# rendered from catalog.schema.json by scripts/render-install-scripts.mjs; edit the schema there
$FileKeyPattern = '^[^/\\:]*[^/\\:. ](?:/[^/\\:]*[^/\\:. ])*(?![\s\S])'
$VersionPattern = '^(?![\s\S]*\.\.)[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]*[0-9A-Za-z-])?(\+[0-9A-Za-z.-]*[0-9A-Za-z-])?(?![\s\S])'
$Sha256Pattern = '^[0-9a-f]{64}(?![\s\S])'
# end of rendered patterns

$HostId = 'forebay-host'
$InstallMarker = '.installed.json'
$UnpackedMarker = '.unpacked'
$RequiredHostFiles = @('host.js', 'reconcile-worker.js', 'host.json')

function Stop-Install([string]$Detail, [string]$Fix) {
    throw "$Detail`nfix: $Fix"
}

function Write-Fetching([string]$Line) {
    [Console]::Error.WriteLine($Line)
}

function Test-Absolute([string]$Path) {
    return $Path -match '^([\\/]|[A-Za-z]:[\\/])'
}

function Resolve-Cache {
    if (Test-Absolute $env:SPISOR_CACHE) { return $env:SPISOR_CACHE.TrimEnd('\', '/') }
    if (Test-Absolute $env:LOCALAPPDATA) { return Join-Path (Join-Path $env:LOCALAPPDATA.TrimEnd('\', '/') 'spisor') 'cache' }
    Stop-Install 'LOCALAPPDATA is absent, empty or not an absolute path, so the cache place cannot be found' 'set LOCALAPPDATA, or SPISOR_CACHE, to an absolute directory path'
}

function Get-PlatformKey {
    $architecture = $env:PROCESSOR_ARCHITEW6432
    if (-not $architecture) { $architecture = $env:PROCESSOR_ARCHITECTURE }
    if (-not $architecture) {
        try { $architecture = "$([System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture)" } catch { $architecture = '' }
    }
    switch ($architecture.ToUpperInvariant()) {
        'AMD64' { return 'win32-x64' }
        'X64' { return 'win32-x64' }
        'ARM64' { return 'win32-arm64' }
    }
    return "win32-$($architecture.ToLowerInvariant())"
}

function Resolve-Catalog([string]$Catalog) {
    if ($Catalog -match '^https://') { return $Catalog }
    if ($Catalog -match '^[A-Za-z][A-Za-z0-9+.-]*://') {
        Stop-Install "the catalog $Catalog is neither an https url nor a local path" 'pass the path of a catalog.json, or its https url'
    }
    $path = [System.IO.Path]::GetFullPath([System.IO.Path]::Combine((Get-Location).ProviderPath, $Catalog))
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
        Stop-Install "the catalog $Catalog does not exist" 'pass the path of a catalog.json, or its https url'
    }
    return $path
}

function Get-FileSha256([string]$Path) {
    return (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
}

function Test-Sha256([string]$Path, [string]$Sha256) {
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { return $false }
    return (Get-FileSha256 $Path) -ceq $Sha256
}

function Receive-File([string]$Url, [string]$Path) {
    $client = New-Object System.Net.WebClient
    try {
        $client.DownloadFile($Url, $Path)
    } catch {
        Stop-Install "could not fetch $Url" 'check the network connection, then run this again'
    } finally {
        $client.Dispose()
    }
}

function New-TemporaryPath([string]$Path) {
    return "$Path.$([guid]::NewGuid().ToString('N')).part"
}

function Remove-Temporary([string]$Part) {
    if (Test-Path -LiteralPath $Part) { Remove-Item -LiteralPath $Part -Force -ErrorAction SilentlyContinue }
}

function Receive-Part([string]$Url, [string]$Part, [string]$Sha256, $Size) {
    Receive-File $Url $Part
    $sizeMatches = ($null -eq $Size) -or ((Get-Item -LiteralPath $Part).Length -eq [long]$Size)
    if (-not $sizeMatches -or -not (Test-Sha256 $Part $Sha256)) {
        Stop-Install "$Url does not have the SHA-256 $Sha256 it is pinned to" 'run this again; if it repeats, the download is being altered on the way'
    }
}

function Receive-Verified([string]$Url, [string]$Path, [string]$Sha256, $Size) {
    $part = New-TemporaryPath $Path
    try {
        Receive-Part $Url $part $Sha256 $Size
        Move-Item -LiteralPath $part -Destination $Path -Force
    } finally {
        Remove-Temporary $part
    }
}

function Find-CompatibleRuntime {
    $ErrorActionPreference = 'Continue'
    $command = Get-Command "$RuntimeName.exe" -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($null -eq $command) { return $null }
    $version = & $command.Source -p 'process.versions.node' 2>$null
    $major = 0
    if ([int]::TryParse(("$version" -split '\.')[0], [ref]$major) -and $major -ge $RuntimeCompatibleMajor) { return $command.Source }
    return $null
}

function Test-RuntimeUnpacked($Runtime) {
    if (-not (Test-Path -LiteralPath $Runtime.Marker -PathType Leaf)) { return $false }
    $lines = @([System.IO.File]::ReadAllLines($Runtime.Marker))
    if ($lines.Count -lt 2 -or $lines[0] -cne $Runtime.Build.Sha256) { return $false }
    return Test-Sha256 $Runtime.Node $lines[1]
}

function Expand-RuntimeExecutable([string]$Archive, $Runtime) {
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $member = "$($Runtime.Stem)/node.exe"
    $zip = [System.IO.Compression.ZipFile]::OpenRead($Archive)
    try {
        $entry = $zip.Entries | Where-Object { $_.FullName.Replace('\', '/') -ceq $member } | Select-Object -First 1
        if ($null -eq $entry) { Stop-Install "the $RuntimeName archive for $($Runtime.Platform) holds no $member" 'run this again; if it repeats, report the pinned archive' }
        New-Item -ItemType Directory -Force -Path (Split-Path -Parent $Runtime.Node) | Out-Null
        [System.IO.Compression.ZipFileExtensions]::ExtractToFile($entry, $Runtime.Node, $true)
    } finally {
        $zip.Dispose()
    }
}

function Test-RuntimeRuns([string]$Node) {
    $ErrorActionPreference = 'Continue'
    try { & $Node -e 0 2>$null | Out-Null } catch { return $false }
    return $LASTEXITCODE -eq 0
}

function Write-UnpackedMarker($Runtime) {
    $part = New-TemporaryPath $Runtime.Marker
    try {
        [System.IO.File]::WriteAllText($part, "$($Runtime.Build.Sha256)`n$(Get-FileSha256 $Runtime.Node)`n")
        Move-Item -LiteralPath $part -Destination $Runtime.Marker -Force
    } finally {
        Remove-Temporary $part
    }
}

function Install-RuntimeExecutable($Runtime) {
    if (Test-Path -LiteralPath $Runtime.Marker) { Remove-Item -LiteralPath $Runtime.Marker -Force }
    $stemDirectory = Join-Path $Runtime.Directory $Runtime.Stem
    if (Test-Path -LiteralPath $stemDirectory) { Remove-Item -LiteralPath $stemDirectory -Recurse -Force }
    Write-Fetching "fetching $RuntimeName $RuntimeVersion for $($Runtime.Platform)"
    $archive = New-TemporaryPath (Join-Path $Runtime.Directory $Runtime.ArchiveName)
    try {
        Receive-Part $Runtime.Build.Url $archive $Runtime.Build.Sha256 $null
        Expand-RuntimeExecutable $archive $Runtime
    } finally {
        Remove-Temporary $archive
    }
    if (-not (Test-RuntimeRuns $Runtime.Node)) {
        Stop-Install "the $RuntimeName $RuntimeVersion executable for $($Runtime.Platform) does not run on this machine" "install $RuntimeName $RuntimeCompatibleMajor or newer, then run this again"
    }
    Write-UnpackedMarker $Runtime
}

function Remove-OtherRuntimeVersions([string]$Cache) {
    $root = Join-Path $Cache "runtimes\$RuntimeName"
    foreach ($version in @(Get-ChildItem -LiteralPath $root -Directory -ErrorAction SilentlyContinue)) {
        if ($version.Name -ceq $RuntimeVersion) { continue }
        try { Remove-Item -LiteralPath $version.FullName -Recurse -Force -ErrorAction Stop } catch {
            # a runtime still running holds its files; the next acquisition removes it
        }
    }
}

function Install-Runtime([string]$Cache, [string]$Platform) {
    $build = $RuntimeBuilds[$Platform]
    if ($null -eq $build) {
        Stop-Install "$RuntimeName $RuntimeVersion has no pinned build for $Platform" "install $RuntimeName $RuntimeCompatibleMajor or newer, then run this again"
    }
    if ($build.Archive -ne 'zip') {
        Stop-Install "the pinned $RuntimeName build for $Platform is a $($build.Archive), which this installer cannot unpack" "install $RuntimeName $RuntimeCompatibleMajor or newer, then run this again"
    }
    $directory = Join-Path $Cache "runtimes\$RuntimeName\$RuntimeVersion\$Platform"
    $archiveName = $build.Url.Substring($build.Url.LastIndexOf('/') + 1)
    $stem = $archiveName.Substring(0, $archiveName.Length - '.zip'.Length)
    $runtime = @{
        Build = $build
        Platform = $Platform
        Directory = $directory
        ArchiveName = $archiveName
        Stem = $stem
        Marker = Join-Path $directory $UnpackedMarker
        Node = Join-Path $directory "$stem\node.exe"
    }
    New-Item -ItemType Directory -Force -Path $directory | Out-Null
    if (-not (Test-RuntimeUnpacked $runtime)) { Install-RuntimeExecutable $runtime }
    Remove-OtherRuntimeVersions $Cache
    return $runtime.Node
}

function Read-CatalogIndex([string]$Catalog) {
    return (Read-CatalogText $Catalog).TrimStart([char]0xFEFF)
}

function Read-CatalogText([string]$Catalog) {
    if ($Catalog -match '^https://') {
        $client = New-Object System.Net.WebClient
        try { return [System.Text.Encoding]::UTF8.GetString($client.DownloadData($Catalog)) } catch { Stop-Install "could not fetch $Catalog" 'check the network connection and the url, then run this again' } finally { $client.Dispose() }
    }
    return [System.IO.File]::ReadAllText($Catalog, [System.Text.Encoding]::UTF8)
}

function Get-HostFiles([string]$Catalog) {
    $text = Read-CatalogIndex $Catalog
    try { $index = $text | ConvertFrom-Json } catch { Stop-Install "the catalog $Catalog is not a JSON catalog index" 'pass the catalog.json of a catalog, or its https url' }
    $item = $null
    if ($null -ne $index.items) { $item = $index.items.PSObject.Properties[$HostId] }
    if ($null -eq $item -or $item.Value.kind -ne 'host') { Stop-Install "the catalog $Catalog lists no $HostId" 'install from a catalog that lists the host' }
    $version = "$($item.Value.latest)"
    $entry = $null
    if ($version -cmatch $VersionPattern -and $null -ne $item.Value.versions) { $entry = $item.Value.versions.PSObject.Properties[$version] }
    if ($null -eq $entry -or $null -eq $entry.Value.files) { Stop-Install "the catalog lists no files for $HostId $version" "install from a catalog whose latest $HostId lists its files" }
    $missing = @($RequiredHostFiles | Where-Object { $null -eq $entry.Value.files.PSObject.Properties[$_] })
    if ($missing.Count -gt 0) { Stop-Install "the catalog lists $HostId $version without $($missing -join ', ')" "install from a catalog whose $HostId lists $($RequiredHostFiles -join ', ')" }
    $origin = New-Object System.Uri($Catalog)
    $directory = $origin.AbsolutePath.Substring(0, $origin.AbsolutePath.LastIndexOf('/') + 1)
    $files = @()
    $seen = New-Object 'System.Collections.Generic.Dictionary[string,string]' ([System.StringComparer]::Ordinal)
    foreach ($property in $entry.Value.files.PSObject.Properties) {
        $folded = $property.Name.Normalize().ToLowerInvariant()
        if ($seen.ContainsKey($folded)) {
            Stop-Install "the catalog lists the $HostId files $($seen[$folded]) and $($property.Name), which differ only by case and would install into one file" 'install from a catalog built by forebay-host catalog build'
        }
        $seen[$folded] = $property.Name
        $reference = $property.Value
        $url = New-Object System.Uri($origin, "$($reference.url)")
        $inside = if ($origin.Scheme -eq 'https') { $url.Scheme -eq 'https' } else { $url.Scheme -eq 'file' -and $url.Host -eq '' -and $url.AbsolutePath.StartsWith($directory, [System.StringComparison]::Ordinal) }
        if (-not ($property.Name -cmatch $FileKeyPattern) -or -not $inside -or -not ("$($reference.sha256)" -cmatch $Sha256Pattern) -or -not ($reference.size -is [int] -or $reference.size -is [long])) {
            Stop-Install "the catalog lists the $HostId file `"$($property.Name)`" with a name, url, sha256 or size the installer refuses" 'install from a catalog built by forebay-host catalog build'
        }
        $files += @{ Key = $property.Name; Url = $url.AbsoluteUri; Sha256 = "$($reference.sha256)"; Size = $reference.size }
    }
    return @{ Version = $version; Files = $files }
}

function Install-HostBundle([string]$Cache, [string]$Catalog) {
    $listing = Get-HostFiles $Catalog
    $directory = Join-Path $Cache "bundles\$HostId\$($listing.Version)"
    $marker = Join-Path $directory $InstallMarker
    New-Item -ItemType Directory -Force -Path $directory | Out-Null
    $hashes = [ordered]@{}
    $changed = $false
    foreach ($file in $listing.Files) {
        $hashes[$file.Key] = $file.Sha256
        $target = Join-Path $directory ($file.Key -replace '/', '\')
        if (Test-Sha256 $target $file.Sha256) { continue }
        Write-Fetching "fetching $HostId $($listing.Version) $($file.Key)"
        if (Test-Path -LiteralPath $marker) { Remove-Item -LiteralPath $marker -Force }
        New-Item -ItemType Directory -Force -Path (Split-Path -Parent $target) | Out-Null
        Receive-Verified $file.Url $target $file.Sha256 $file.Size
        $changed = $true
    }
    if ($changed -or -not (Test-Path -LiteralPath $marker)) {
        $markerPart = New-TemporaryPath $marker
        try {
            [System.IO.File]::WriteAllText($markerPart, (@{ files = $hashes } | ConvertTo-Json))
            Move-Item -LiteralPath $markerPart -Destination $marker -Force
        } finally {
            Remove-Temporary $markerPart
        }
    }
    return Join-Path $directory 'host.js'
}

function Initialize-Install([object[]]$Arguments) {
    if ($Arguments.Count -lt 1 -or -not "$($Arguments[0])") {
        Stop-Install 'no catalog was given, and none is published yet' 'pass the catalog to install from: install.ps1 <path or https url of catalog.json>'
    }
    $catalog = Resolve-Catalog "$($Arguments[0])"
    $rest = @()
    if ($Arguments.Count -gt 1) { $rest = @($Arguments[1..($Arguments.Count - 1)]) }
    [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
    $cache = Resolve-Cache
    $node = Find-CompatibleRuntime
    if ($null -eq $node) { $node = Install-Runtime $cache (Get-PlatformKey) }
    $hostFile = Install-HostBundle $cache $catalog
    return @{ Node = $node; HostFile = $hostFile; Catalog = $catalog; Rest = $rest }
}

function Complete-Install([int]$Code) {
    # run through irm | iex there is no script file, and exit would close the user's shell
    if ($MyInvocation.ScriptName) { exit $Code }
    $global:LASTEXITCODE = $Code
}

$prepared = $null
try {
    $prepared = Initialize-Install $args
} catch {
    [Console]::Error.WriteLine($_.Exception.Message)
}
if ($null -eq $prepared) {
    Complete-Install 1
} else {
    $ErrorActionPreference = 'Continue'
    & $prepared.Node $prepared.HostFile install "--catalog=$($prepared.Catalog)" @($prepared.Rest)
    Complete-Install $LASTEXITCODE
}
} @args
