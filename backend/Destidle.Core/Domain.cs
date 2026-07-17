namespace Destidle.Core;

public enum Game { D1 = 1, D2 = 2 }
public enum ItemCategory { Weapon = 1, Armor = 2 }
// Valeurs de l'enum Bungie DamageType (communes D1/D2)
public enum Element { Kinetic = 1, Arc = 2, Solar = 3, Void = 4, Stasis = 6, Strand = 7 }
// Valeurs Bungie classType
public enum GuardianClass { Titan = 0, Hunter = 1, Warlock = 2 }

public class Item
{
    public int Id { get; set; }
    public long BungieHash { get; set; }
    public Game Game { get; set; }
    public ItemCategory Category { get; set; }
    public required string NameEn { get; set; }
    public required string NameFr { get; set; }
    public required string RarityEn { get; set; }
    public required string RarityFr { get; set; }
    public required string TypeEn { get; set; }
    public required string TypeFr { get; set; }
    public int? SlotIndex { get; set; }      // armes : 1/2/3 ; armures : null
    public string? SlotEn { get; set; }
    public string? SlotFr { get; set; }
    public Element? Element { get; set; }    // armes uniquement
    public string? ElementEn { get; set; }
    public string? ElementFr { get; set; }
    public GuardianClass? Class { get; set; }// armures uniquement
    public string? ClassEn { get; set; }
    public string? ClassFr { get; set; }
    public int SeasonIdx { get; set; }
    public required string SeasonEn { get; set; }
    public required string SeasonFr { get; set; }
    public required string SplashFile { get; set; } // nom de fichier opaque (HMAC), ex "3fa2…c1.jpg"
    public required string IconFile { get; set; }
    public string? LightGgUrl { get; set; }  // D2 uniquement
}
