param(
    [Parameter(Mandatory = $true)]
    [string]$AssemblyPath,
    [Parameter(Mandatory = $true)]
    [string]$TypeName,
    [Parameter(Mandatory = $true)]
    [string[]]$MethodName
)

$oneByte = @{}
$twoByte = @{}
[Reflection.Emit.OpCodes].GetFields([Reflection.BindingFlags]'Public,Static') | ForEach-Object {
    $opcode = $_.GetValue($null)
    $value = [uint16]($opcode.Value -band 0xffff)
    if ($value -lt 0x100) {
        $oneByte[[byte]$value] = $opcode
    } elseif (($value -band 0xff00) -eq 0xfe00) {
        $twoByte[[byte]($value -band 0xff)] = $opcode
    }
}

function Read-Int16([byte[]]$Bytes, [ref]$Position) {
    $value = [BitConverter]::ToInt16($Bytes, $Position.Value)
    $Position.Value += 2
    return $value
}

function Read-Int32([byte[]]$Bytes, [ref]$Position) {
    $value = [BitConverter]::ToInt32($Bytes, $Position.Value)
    $Position.Value += 4
    return $value
}

function Format-Token($Module, [int]$Token, [string]$Kind) {
    try {
        if ($Kind -eq 'string') {
            return '"' + ($Module.ResolveString($Token) -replace '"', '\"') + '"'
        }
        if ($Kind -eq 'signature') {
            return ($Module.ResolveSignature($Token) | ForEach-Object { $_.ToString('x2') }) -join ' '
        }
        return $Module.ResolveMember($Token).ToString()
    } catch {
        return ('token 0x{0:x8}' -f $Token)
    }
}

function Write-MethodIL($Method) {
    "`n===== $($Method.DeclaringType.FullName).$($Method.Name) ====="
    $body = $Method.GetMethodBody()
    if ($null -eq $body) {
        '<no method body>'
        return
    }
    $bytes = $body.GetILAsByteArray()
    $position = 0
    while ($position -lt $bytes.Length) {
        $offset = $position
        $first = $bytes[$position]
        $position++
        if ($first -eq 0xfe) {
            $opcode = $twoByte[$bytes[$position]]
            $position++
        } else {
            $opcode = $oneByte[$first]
        }
        if ($null -eq $opcode) {
            ('IL_{0:x4}: <unknown 0x{1:x2}>' -f $offset, $first)
            continue
        }

        $operand = ''
        switch ($opcode.OperandType.ToString()) {
            'InlineNone' { }
            'ShortInlineI' {
                $raw = [int]$bytes[$position]
                $operand = ($(if ($raw -ge 128) { $raw - 256 } else { $raw })).ToString()
                $position++
            }
            'InlineI' { $operand = (Read-Int32 $bytes ([ref]$position)).ToString() }
            'InlineI8' {
                $operand = [BitConverter]::ToInt64($bytes, $position)
                $position += 8
            }
            'ShortInlineR' {
                $operand = [BitConverter]::ToSingle($bytes, $position)
                $position += 4
            }
            'InlineR' {
                $operand = [BitConverter]::ToDouble($bytes, $position)
                $position += 8
            }
            'ShortInlineVar' {
                $operand = $bytes[$position].ToString()
                $position++
            }
            'InlineVar' { $operand = (Read-Int16 $bytes ([ref]$position)).ToString() }
            'ShortInlineBrTarget' {
                $raw = [int]$bytes[$position]
                $delta = $(if ($raw -ge 128) { $raw - 256 } else { $raw })
                $position++
                $operand = 'IL_{0:x4}' -f ($position + $delta)
            }
            'InlineBrTarget' {
                $delta = Read-Int32 $bytes ([ref]$position)
                $operand = 'IL_{0:x4}' -f ($position + $delta)
            }
            'InlineSwitch' {
                $count = Read-Int32 $bytes ([ref]$position)
                $base = $position + (4 * $count)
                $targets = @()
                for ($i = 0; $i -lt $count; $i++) {
                    $targets += ('IL_{0:x4}' -f ($base + (Read-Int32 $bytes ([ref]$position))))
                }
                $operand = $targets -join ', '
            }
            'InlineString' {
                $token = Read-Int32 $bytes ([ref]$position)
                $operand = Format-Token $Method.Module $token 'string'
            }
            'InlineSig' {
                $token = Read-Int32 $bytes ([ref]$position)
                $operand = Format-Token $Method.Module $token 'signature'
            }
            { $_ -in @('InlineMethod', 'InlineField', 'InlineType', 'InlineTok') } {
                $token = Read-Int32 $bytes ([ref]$position)
                $operand = Format-Token $Method.Module $token 'member'
            }
            default { $operand = "<unsupported $($opcode.OperandType)>" }
        }
        ('IL_{0:x4}: {1,-12} {2}' -f $offset, $opcode.Name, $operand)
    }
}

$assembly = [Reflection.Assembly]::LoadFrom((Resolve-Path $AssemblyPath))
$type = $assembly.GetType($TypeName, $true)
$flags = [Reflection.BindingFlags]'Instance,Static,Public,NonPublic,DeclaredOnly'
$MethodName = @($MethodName | ForEach-Object { $_ -split ',' })
foreach ($name in $MethodName) {
    $methods = @($type.GetMethods($flags) | Where-Object Name -eq $name)
    if ($methods.Count -eq 0) {
        Write-Error "Method not found: $TypeName.$name"
        continue
    }
    $methods | ForEach-Object { Write-MethodIL $_ }
}
